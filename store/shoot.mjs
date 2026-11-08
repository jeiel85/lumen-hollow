// 플레이 스토어 스크린샷을 실제 게임 화면으로 찍는다(#52). 휴대폰 터치 화면(세로 1080×1920, 가로 1920×1080).
// 저장소 폴더를 정적 서버로 띄우고 실행한다. ?app으로 앱처럼 연다(로컬 개발에서만 된다, 웹판은 1장 데모).
//   node store/shoot.mjs [url]          (url 기본값 http://127.0.0.1:8000/?debug)
// 결과: store/screenshots/*.jpg(Play는 24비트 JPEG·PNG를 받는다. 저장소가 커지지 않게 JPEG 92). 게임 화면이 바뀌면 다시 찍는다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/e2e/cdp.mjs';

const [,, rawUrl = 'http://127.0.0.1:8000/?debug'] = process.argv;
const url = (() => { const u = new URL(rawUrl); u.searchParams.set('app', '1'); return u.href; })();
const out = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(out, { recursive: true });

const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];

async function open(cssW, cssH) {
  const B = await launch(url, cssW, cssH);
  // 가로 화면도 휴대폰(터치)으로: launch는 폭 700 이상을 마우스 창으로 띄우므로 다시 맞추고 새로 연다.
  await B.send('Emulation.setDeviceMetricsOverride', { width: cssW, height: cssH, deviceScaleFactor: 2, mobile: true });
  await B.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // 처음 열린 페이지가 다 뜬 뒤에 온라인을 끄고(스크린샷에 '보급품을 불러오지 못했다' 안내가 끼지 않게) 새로 연다.
  const ready = async () => {
    for (let i = 0; i < 120; i++) {
      if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return true;
      await B.sleep(500);
    }
    return false;
  };
  if (!(await ready())) throw new Error('게임이 준비되지 않았다(처음 열기)');
  await B.ev('lumen.online.setEnabled(false); return 1');
  await B.send('Page.reload', {});
  await B.sleep(2000);
  if (!(await ready())) throw new Error('게임이 준비되지 않았다(다시 열기)');
  await B.ev(`
    const L = lumen;
    window.T = {
      settle(max = 80) {
        for (let i = 0; i < max; i++) {
          if (L.dialogue.docOpen) { if (L.dialogue.docFlip) L.dialogue.docFlip(); L.dialogue.closeDoc(); }
          if (L.dialogue.scene) L.dialogue.skip();
          L.step(0.4);
          if (L.game.state !== 'story' && !L.dialogue.busy && !L.storyQueue.length) return i;
        }
        return -1;
      },
      clean() { L.hud.clearToasts?.(); },
      goto(x, z) { L.player.pos.set(x, L.ground.heightAt(x, z), z); L.step(0.1); },
      hold(sec = 1.2) { L.input.keys.add('KeyE'); L.step(sec, 1 / 30); L.input.keys.delete('KeyE'); L.step(0.1); },
      flashlight() { L.input.pressed.add('KeyF'); L.step(0.1); },
    };
    return 1;`);
  return B;
}

async function snap(B, name) {
  await B.sleep(1200); // CSS 전환·블룸이 실제 시간으로 자리 잡게
  await B.ev('lumen.hud.clearToasts(); return 1');
  await B.sleep(400);
  const r = await B.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  writeFileSync(`${out}${name}.jpg`, Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
}

async function shootSet(B, tag) {
  // 1) 비 오는 첫 밤: 은신처 가로등 앞, 손전등으로 그늘이를 비춘다
  await B.ev(`lumen.startGame(); lumen.step(0.3); T.settle(); lumen.env.setHour(21.4); lumen.step(6); T.settle(); T.flashlight(); lumen.step(1.2); T.clean(); return 1`);
  await snap(B, `${tag}-1-night`);
  // 2) 트럭 전조등: 트럭에 타서 조금 달린다
  await B.ev(`const car = lumen.car; car.fuel = 80;
    const s = Math.sin(car.a), c = Math.cos(car.a); T.goto(car.pos.x + 1.6 * c, car.pos.z - 1.6 * s); T.hold(0.9);
    lumen.input.keys.add('KeyW'); lumen.step(1.2, 1 / 30); lumen.input.keys.delete('KeyW'); lumen.step(0.4); T.clean(); return lumen.game.driving`);
  await snap(B, `${tag}-2-truck`);
  // 3) 배전반: 오늘 밤 불을 켤 동네 고르기
  await B.ev(`for (let i = 0; i < 6 && lumen.game.driving; i++) T.hold(0.9); lumen.step(0.3); lumen.openGrid(); lumen.step(0.3); return lumen.game.state`);
  await snap(B, `${tag}-3-grid`);
  await B.ev(`lumen.closeGrid(); lumen.step(0.2); return 1`);
  // 4) 낮의 읍내: 구역 몇 곳을 살린 뒤 아침에 골목을 걷는다
  await B.ev(`for (const id of ${JSON.stringify(CH1.slice(0, 6))}) lumen.story.markSeen(id);
    const boxes = lumen.world.fuseBoxes; for (let i = 0; i < Math.min(2, boxes.length); i++) lumen.world.powerZone(boxes[i].zone);
    lumen.env.setHour(9.2); lumen.step(1); T.settle();
    const b = boxes[3] ?? boxes[0]; T.goto(b.x + 2.5, b.z + 2.5); lumen.step(0.5); T.clean(); return 1`);
  await snap(B, `${tag}-4-day`);
  // 5) 이야기 장면: 할머니의 고백(컷신 그림)
  await B.ev(`lumen.backToTitle(); lumen.step(0.2); lumen.startGame(); lumen.step(0.3); T.settle(); lumen.playScene('promise'); lumen.step(0.6);
    for (let i = 0; i < 3; i++) { lumen.dialogue.advance(); lumen.step(0.4); } return lumen.dialogue.scene?.id`);
  await snap(B, `${tag}-5-story`);
  await B.ev(`lumen.dialogue.skip(); lumen.step(0.3); T.settle(); return 1`);
}

let B = await open(540, 960);
await shootSet(B, 'phone');
B.close();
B = await open(960, 540);
await shootSet(B, 'land');
B.close();
process.exit(0);
