import * as THREE from 'three';

// 후처리: 블룸 + 틸트시프트(미니어처) + 색보정 + 비네트 + 톤매핑.
// 장면은 HDR(HalfFloat) 타깃에 그리고 마지막 패스에서 sRGB로 내보낸다.

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BRIGHT = `
  uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uThreshold;
  varying vec2 vUv;
  void main(){
    vec3 c = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tDiffuse, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tDiffuse, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tDiffuse, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    c *= 0.25;
    // NaN/Inf 픽셀 하나가 블룸 블러로 사각형 얼룩이 되지 않게 걸러 낸다.
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    c = min(c, vec3(64.0));
    float l = max(c.r, max(c.g, c.b));
    float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
    gl_FragColor = vec4(c * k, 1.0);
  }`;

const BLUR = `
  uniform sampler2D tDiffuse; uniform vec2 uDir;
  varying vec2 vUv;
  void main(){
    vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    s += (texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
    s += (texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }`;

const TILT_COMMON = `
  uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uMaxBlur; uniform float uFocus; uniform float uBand;
  varying vec2 vUv;
  vec3 tiltBlur(vec2 dir){
    float d = abs(vUv.y - uFocus);
    float r = uMaxBlur * smoothstep(uBand, uBand + 0.32, d);
    // 고정 반복 + textureLod: 분기 없는 루프라 미분 경고가 나지 않는다. r=0이면 원본과 같다.
    vec2 st = dir * uTexel * (r / 4.0);
    vec3 s = vec3(0.0); float w = 0.0;
    for (int i = -4; i <= 4; i++) {
      float fi = float(i);
      float wt = exp(-fi * fi / 8.0);
      s += textureLod(tDiffuse, vUv + st * fi, 0.0).rgb * wt;
      w += wt;
    }
    return s / w;
  }`;

const TILT_H = `${TILT_COMMON}
  void main(){ gl_FragColor = vec4(tiltBlur(vec2(1.0, 0.0)), 1.0); }`;

const FINAL = `${TILT_COMMON}
  uniform sampler2D tBloom; uniform float uBloom; uniform float uExposure; uniform vec3 uTint; uniform vec3 uLift;
  uniform float uSat; uniform float uVignette; uniform float uTime; uniform vec2 uRes; uniform float uHurt;
  uniform float uFog; uniform vec3 uFogColor;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 toSRGB(vec3 c){
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 filmic(vec3 x){
    // ACES 근사 (Narkowicz). 노출을 조금 낮춰 파스텔 톤을 유지한다.
    x *= 0.82;
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  void main(){
    vec3 c = tiltBlur(vec2(0.0, 1.0));
    c += texture2D(tBloom, vUv).rgb * uBloom;
    c *= uExposure * uTint;
    c = filmic(c);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = c + uLift * (1.0 - c);
    vec2 q = vUv - 0.5;
    float v = 1.0 - dot(q, q) * uVignette;
    c *= clamp(v, 0.0, 1.0);
    // 안개 낀 밤(#57): 화면 가운데(플레이어) 둘레만 보이고 바깥은 천천히 흐르는 안개에 묻힌다.
    if (uFog > 0.001) {
      vec2 p = q * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
      float drift = 0.5 + 0.5 * sin(p.x * 6.0 + uTime * 0.17) * sin(p.y * 8.0 - uTime * 0.13);
      float fd = smoothstep(0.14, 0.48, length(p));
      c = mix(c, uFogColor, clamp(uFog * fd * (0.78 + 0.18 * drift), 0.0, 1.0));
    }
    float edge = smoothstep(0.25, 0.75, length(q));
    c = mix(c, vec3(0.55, 0.05, 0.05), uHurt * edge * 0.75);
    c = toSRGB(c);
    c += (hash(vUv * uRes + fract(uTime) * 61.0) - 0.5) * 0.025;
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Post {
  constructor(renderer, { samples = 4 } = {}) {
    this.r = renderer;
    const hf = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.rtTilt = new THREE.WebGLRenderTarget(1, 1, hf);
    this.rtB1 = new THREE.WebGLRenderTarget(1, 1, hf);
    this.rtB2 = new THREE.WebGLRenderTarget(1, 1, hf);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qs = new THREE.Scene();
    this.qs.add(this.quad);

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    const tilt = () => ({
      tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxBlur: { value: 6 },
      uFocus: { value: 0.5 }, uBand: { value: 0.1 },
    });
    this.mBright = mk(BRIGHT, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 } });
    this.mBlur = mk(BLUR, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mTilt = mk(TILT_H, tilt());
    this.mFinal = mk(FINAL, {
      ...tilt(),
      tBloom: { value: null }, uBloom: { value: 0.5 }, uExposure: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) },
      uLift: { value: new THREE.Color(0, 0, 0) }, uSat: { value: 1 }, uVignette: { value: 1 }, uTime: { value: 0 },
      uRes: { value: new THREE.Vector2() }, uHurt: { value: 0 },
      uFog: { value: 0 }, uFogColor: { value: new THREE.Color(0.075, 0.1, 0.11) },
    });
    this.w = 1;
    this.h = 1;
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    this.rtScene.setSize(w, h);
    this.rtTilt.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / 4));
    const bh = Math.max(1, Math.floor(h / 4));
    this.rtB1.setSize(bw, bh);
    this.rtB2.setSize(bw, bh);
    this.bw = bw;
    this.bh = bh;
    const blur = Math.max(2, h * 0.0085);
    for (const m of [this.mTilt, this.mFinal]) {
      m.uniforms.uTexel.value.set(1 / w, 1 / h);
      m.uniforms.uMaxBlur.value = blur;
    }
    this.mBright.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.mFinal.uniforms.uRes.value.set(w, h);
  }

  // 화질 설정으로 MSAA 샘플 수를 바꾼다. 렌더 타깃을 버리면 다음에 쓸 때 새 샘플 수로 다시 만든다.
  setSamples(samples) {
    if (this.rtScene.samples === samples) return;
    this.rtScene.samples = samples;
    this.rtScene.dispose();
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qs, this.cam);
  }

  render(scene, camera, look, time, opts) {
    const r = this.r;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    this.mBright.uniforms.tDiffuse.value = this.rtScene.texture;
    this.mBright.uniforms.uThreshold.value = look.threshold;
    this._pass(this.mBright, this.rtB1);
    const tx = 1 / this.bw;
    const ty = 1 / this.bh;
    for (const spread of [1, 2.2]) {
      this.mBlur.uniforms.tDiffuse.value = this.rtB1.texture;
      this.mBlur.uniforms.uDir.value.set(tx * spread, 0);
      this._pass(this.mBlur, this.rtB2);
      this.mBlur.uniforms.tDiffuse.value = this.rtB2.texture;
      this.mBlur.uniforms.uDir.value.set(0, ty * spread);
      this._pass(this.mBlur, this.rtB1);
    }

    for (const m of [this.mTilt, this.mFinal]) {
      m.uniforms.uFocus.value = opts.focus;
      m.uniforms.uBand.value = opts.band;
      m.uniforms.uMaxBlur.value = Math.max(2, this.h * 0.0085) * opts.blurScale;
    }
    this.mTilt.uniforms.tDiffuse.value = this.rtScene.texture;
    this._pass(this.mTilt, this.rtTilt);

    const u = this.mFinal.uniforms;
    u.tDiffuse.value = this.rtTilt.texture;
    u.tBloom.value = this.rtB1.texture;
    u.uBloom.value = look.bloom;
    u.uExposure.value = look.exposure;
    u.uTint.value.copy(look.tint);
    u.uLift.value.copy(look.lift);
    u.uSat.value = look.sat;
    u.uVignette.value = look.vignette;
    u.uTime.value = time;
    u.uHurt.value = opts.hurt;
    u.uFog.value = opts.fog ?? 0;
    this._pass(this.mFinal, null);
  }
}
