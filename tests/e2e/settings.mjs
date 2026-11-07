// 설정·옷장 회귀(#10·#15·#17·#20): 온라인 켜기/끄기가 설정 화면에 있고, 기록 파일 v2로 옷장·이야기 진행을 내보내고 가져오며,
// 옷장 포커스·잠긴 항목·미리보기 시선, 저장소가 막힌 브라우저의 안내를 확인한다.
//   node tests/e2e/settings.mjs [url] [폭 높이]
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720'] = process.argv;
const B = await launch(url, +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return;
    await B.sleep(500);
  }
};
await ready();
const $ = (id) => `document.getElementById('${id}')`;
const skip = `for (let i = 0; i < 40 && (lumen.dialogue.scene || lumen.game.state === 'story'); i++) { if (lumen.dialogue.scene) lumen.dialogue.skip(); lumen.step(0.3); }`;
// 파일 입력에 내용을 넣고 change를 보낸다(사용자가 파일을 고른 것과 같다).
const pick = (json) => `const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(json)}], 'records.json', { type: 'application/json' }));
  const inp = ${$('records-file')}; inp.files = dt.files; inp.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 300));`;

// ---------------------------------------------------------------- 온라인 켜기/끄기는 설정 화면에(#17)
let r = await B.ev(`const t = ${$('title')};
  const onTitle = !!t.querySelector('#online-toggle, #online-forget');
  ${$('settings-btn')}.click();
  const tg = ${$('online-toggle')}; const before = [tg.textContent, tg.getAttribute('aria-pressed')];
  tg.click(); const off = [tg.textContent, tg.getAttribute('aria-pressed'), ${$('online-msg')}.textContent, ${$('online-summary')}.textContent];
  tg.click(); const on = [tg.textContent, tg.getAttribute('aria-pressed')];
  const note = ${$('online-panel')}.querySelector('.online-note');
  return { onTitle, panel: !${$('online-panel')}.classList.contains('hidden'), before, off, on, note: note && note.offsetParent !== null ? note.textContent : null }`);
check('처음 화면에는 온라인 단추가 없고 설정 화면에 있다', !r.onTitle && r.panel, r);
check('설정 화면에서 켜고 끈다(글자·aria-pressed, 꺼 두면 처음 화면 소식도 바뀐다)',
  r.before[1] === 'true' && r.off[0] === '온라인 보급품 꺼짐' && r.off[1] === 'false' && r.off[2].includes('아무것도 보내지') && r.off[3].includes('설정에서') && r.on[1] === 'true', r);
check('켜기/끄기 옆에 개인정보 안내가 보인다', r.note && r.note.includes('무작위 ID'), r.note);
await B.shot('settings-online');

// ---------------------------------------------------------------- 기록 파일 v2 내보내기
r = await B.ev(`lumen.wardrobe.unlock('hat.cap'); lumen.wardrobe.put('hat.cap'); lumen.story.markSeen('arrival'); lumen.story.markFound('log');
  ${$('settings-close')}.click(); ${$('settings-btn')}.click();
  // 데스크톱은 다운로드, 휴대폰은 공유 시트로 넘긴다. 헤드리스에는 공유 시트가 없어 둘 다 가로채 파일 내용을 본다.
  let blob = null; const keep = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
  const share = navigator.share; navigator.share = async ({ files }) => { blob = files[0]; };
  ${$('records-export')}.click(); await new Promise((r) => setTimeout(r, 100)); URL.createObjectURL = keep; navigator.share = share;
  const data = JSON.parse(await blob.text());
  return { data, progress: ${$('records-progress')}.textContent, msg: ${$('records-msg')}.textContent }`);
check('내보낸 파일은 v2이고 옷장·이야기·2~4장 진행을 담는다',
  r.data.version === 2 && r.data.wardrobe.owned.includes('hat.cap') && r.data.wardrobe.wear.hat === 'hat.cap' && r.data.story.seen.includes('arrival') && r.data.story.found.includes('log') && Array.isArray(r.data.chapters.flags),
  { version: r.data.version, wardrobe: r.data.wardrobe, story: r.data.story, chapters: r.data.chapters });
check('기록 묶음에 함께 담는 진행이 보인다', r.progress.includes('옷가지') && r.progress.includes('들은 이야기'), r.progress);

// ---------------------------------------------------------------- 기록 파일 가져오기(합집합, 건너뛴 값 안내)
const v2 = JSON.stringify({
  format: 'lumen-hollow-records', version: 2, exportedAt: '2026-11-08T00:00:00.000Z',
  best: { nights: 4, zones: 99, winDay: 0 },
  wardrobe: { v: 1, owned: ['coat.teal', 'hat.mystery'], wear: { coat: 'coat.teal' } },
  story: { v: 1, seen: ['arrival', 'dusk', 'no-such-scene'], found: [] },
  chapters: { v: 1, flags: ['flip'] },
});
r = await B.ev(`${pick(v2)}
  return { msg: ${$('records-msg')}.textContent, cls: ${$('records-msg')}.className, coat: lumen.wardrobe.has('coat.teal'), wearCoat: lumen.wardrobe.wear.coat, hat: lumen.wardrobe.wear.hat,
    seen: lumen.story.isSeen('dusk'), keepFound: lumen.story.isFound('log'), flip: lumen.chapters.flag('flip'), stored: JSON.parse(localStorage.getItem('lumen.wardrobe')).owned,
    best: JSON.parse(localStorage.getItem('lumen.best')) }`);
check('v2 가져오기: 옷가지·장면·2~4장 표시를 더하고 이 기기 진행은 남긴다',
  r.coat && r.wearCoat === 'coat.teal' && r.hat === 'hat.cap' && r.seen && r.keepFound && r.flip && r.stored.includes('coat.teal') && r.stored.includes('hat.cap'), r);
check('버린 값의 수를 알린다(구역 99, 모르는 옷가지, 모르는 장면)', r.msg.includes('항목 3개는 건너뛰었어요') && r.msg.includes('새로 더한 것') && r.cls.includes('good'), r.msg);
const v1 = JSON.stringify({ format: 'lumen-hollow-records', version: 1, exportedAt: '2026-11-01T00:00:00.000Z', best: { nights: 7, zones: 3, winDay: 0 } });
r = await B.ev(`${pick(v1)} return { msg: ${$('records-msg')}.textContent, best: JSON.parse(localStorage.getItem('lumen.best')), coat: lumen.wardrobe.has('coat.teal') }`);
check('v1 파일도 그대로 읽는다(최고 기록만 합치고 진행은 그대로)', r.best.nights === 7 && r.coat && !r.msg.includes('건너뛰'), r);
r = await B.ev(`${pick('{"format":"lumen-hollow-records","version":3,"best":{}}')} return ${$('records-msg')}.textContent`);
check('더 새 버전 파일은 거부한다', r.includes('더 새 버전'), r);
await B.shot('settings-import');

// ---------------------------------------------------------------- 판 도중(일시정지에서 연 설정)에는 가져오기·온라인 설정을 막는다
r = await B.ev(`${$('settings-close')}.click(); lumen.startGame(); lumen.step(0.3); ${skip}; lumen.pauseGame(true); ${$('pause-settings-btn')}.click();
  return { imp: ${$('records-import')}.disabled, msg: ${$('records-msg')}.textContent, toggle: ${$('online-toggle')}.disabled, forget: ${$('online-forget')}.disabled, omsg: ${$('online-msg')}.textContent }`);
check('일시정지에서 연 설정: 가져오기·온라인 켜기/끄기·지우기를 막고 이유를 보인다', r.imp && r.toggle && r.forget && r.msg.includes('처음 화면') && r.omsg.includes('처음 화면'), r);
r = await B.ev(`${$('settings-close')}.click(); lumen.backToTitle(); lumen.step(0.3); ${$('settings-btn')}.click();
  const res = { imp: ${$('records-import')}.disabled, toggle: ${$('online-toggle')}.disabled }; ${$('settings-close')}.click(); return res`);
check('처음 화면에서 연 설정에서는 다시 쓸 수 있다', !r.imp && !r.toggle, r);

// ---------------------------------------------------------------- 옷장: 포커스, 잠긴 항목, 미리보기 시선
r = await B.ev(`${$('closet-btn')}.click(); lumen.step(0.1);
  const items = [...document.querySelectorAll('#closet-grid .closet-item')]; const lockedBtn = items.find((b) => b.classList.contains('locked'));
  return { active: document.activeElement?.id, az: lumen.closet.az, lockedDisabled: lockedBtn?.disabled, aria: lockedBtn?.getAttribute('aria-disabled'), desc: lockedBtn?.getAttribute('aria-describedby'), tab: lockedBtn?.tabIndex }`);
check('옷장을 열면 패널 제목으로 포커스가 간다', r.active === 'closet-title', r);
check('잠긴 항목은 disabled가 아니라 aria-disabled(+설명)라 Tab·스크린리더가 건너뛰지 않는다', r.lockedDisabled === false && r.aria === 'true' && r.desc === 'closet-note' && r.tab === 0, r);
check('은신처 앞 기본 방위(π/4)로 비춘다', Math.abs(r.az - Math.PI / 4) < 1e-6, r.az);
r = await B.ev(`const L = lumen; L.closeCloset(); const focus = document.activeElement?.id;
  L.car.reset(2.6, 5.8, Math.PI / 4); L.step(0.1); ${$('closet-btn')}.click(); L.step(0.2); return { focus, az: L.closet.az }`);
check('닫으면 옷장 칩으로 포커스가 돌아온다', r.focus === 'closet-btn', r.focus);
check('트럭이 인물 앞을 가리면 다른 방위를 고른다', Math.abs(r.az - Math.PI / 4) > 0.1, r.az);
await B.sleep(400);
await B.shot('closet-truck-avoid');
await B.ev(`lumen.closeCloset(); return true`);

let errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);

// ---------------------------------------------------------------- 저장소가 막힌 브라우저(사생활 보호 모드 흉내)
await B.send('Page.addScriptToEvaluateOnNewDocument', { source: `Storage.prototype.setItem = function () { throw new DOMException('blocked', 'SecurityError'); };` });
await B.send('Page.reload', { ignoreCache: true });
await B.sleep(1500);
await ready();
r = await B.ev(`${$('settings-btn')}.click(); const s = { settings: ${$('settings-store')}.textContent, records: ${$('records-store')}.textContent };
  document.querySelector('[data-setting="fps"]').click(); s.after = ${$('settings-store')}.textContent; ${$('settings-close')}.click(); return s`);
check('설정: 저장소가 막혔으면 이번 세션에만 적용된다고 보인다', r.settings.includes('이번 세션에만') && r.after.includes('이번 세션에만') && r.records.includes('저장소를 막아'), r);
await B.ev(`${$('settings-btn')}.click(); return true`);
await B.shot('settings-blocked');
r = await B.ev(`${$('settings-close')}.click(); ${$('closet-btn')}.click(); lumen.step(0.1); const t = ${$('closet-store')}.textContent; lumen.closeCloset(); return t`);
check('옷장: 저장소가 막혔으면 이번 세션에만 남는다고 보인다', r.includes('이번 세션에만'), r);
r = await B.ev(`const L = lumen; L.startGame(); L.step(0.3); ${skip};
  const d = L.drops.list[0]; L.player.pos.set(d.x, L.world.heightAt(d.x, d.z), d.z); L.step(0.2);
  return { toasts: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent), owned: L.wardrobe.has(d.item.id), ok: L.wardrobe.storeOk }`);
check('옷을 주우면 이번 세션에만 남는다고 알린다', r.owned && !r.ok && r.toasts.some((t) => t.includes('이번 세션에만')), r);
errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_|blocked|SecurityError/i.test(l));
check('콘솔 오류 없음(저장소 차단 경고 제외)', errs.length === 0, errs);

console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
