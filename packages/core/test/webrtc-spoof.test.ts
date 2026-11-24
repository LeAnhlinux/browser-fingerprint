import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { webrtcSpoofScript } from '../src/webrtc-spoof';

const SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:secret',
  'a=mid:0',
  'a=sctp-port:5000',
  '',
].join('\r\n');

/** Mô phỏng nhân hiện tại: chặn UDP nên gom ứng viên xong ngay mà không có ứng viên nào. */
const FAKE_BROWSER = `(() => {
class RTCIceCandidate { constructor(init) { Object.assign(this, init); } }
class RTCPeerConnectionIceEvent extends Event { constructor(type, init) { super(type); this.candidate = init.candidate; } }
class RTCSessionDescription { constructor(init) { this.type = init.type; this.sdp = init.sdp; } }
// EventTarget của Node thuộc realm khác; lớp nền này giữ chuỗi prototype tĩnh trong cùng realm như trình duyệt.
function ET() { return Reflect.construct(EventTarget, [], new.target); }
ET.prototype = Object.create(EventTarget.prototype);
for (const k of Object.getOwnPropertySymbols(EventTarget)) ET[k] = EventTarget[k];
class RTCPeerConnection extends ET {
  constructor(config) { super(); this._local = null; this._state = 'new'; this._handler = null; }
  get localDescription() { return this._local; }
  get currentLocalDescription() { return this._local; }
  get pendingLocalDescription() { return null; }
  get iceGatheringState() { return this._state; }
  set onicecandidate(fn) { if (!this._handler) this.addEventListener('icecandidate', (e) => this._handler && this._handler(e)); this._handler = fn; }
  get onicecandidate() { return this._handler; }
  setConfiguration(c) { this._config = c; }
  gather(sdp) {
    this._local = new RTCSessionDescription({ type: 'offer', sdp });
    this._state = 'complete';
    this.dispatchEvent(new RTCPeerConnectionIceEvent('icecandidate', { candidate: null }));
  }
}
globalThis.RTCIceCandidate = RTCIceCandidate;
globalThis.RTCPeerConnectionIceEvent = RTCPeerConnectionIceEvent;
globalThis.RTCSessionDescription = RTCSessionDescription;
globalThis.RTCPeerConnection = RTCPeerConnection;
globalThis.webkitRTCPeerConnection = RTCPeerConnection;
})();`;

function browser(ip = '203.0.113.7'): vm.Context {
  const ctx = vm.createContext({ Event, EventTarget, crypto: webcrypto });
  vm.runInContext(FAKE_BROWSER, ctx);
  vm.runInContext(`globalThis.before = {
    pc: Function.prototype.toString.call(RTCPeerConnection),
    ts: Function.prototype.toString.call(Function.prototype.toString),
    getter: Function.prototype.toString.call(Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'localDescription').get),
  };`, ctx);
  vm.runInContext(webrtcSpoofScript(ip), ctx);
  return ctx;
}

/** Chạy như một trang: tạo kết nối, gom ứng viên, trả về những gì trang thấy. */
function gather(ctx: vm.Context, config: string): { candidates: (Record<string, unknown> | null)[]; sdp: string; sdp2Same: boolean } {
  return vm.runInContext(`(() => {
    const pc = new RTCPeerConnection(${config});
    const candidates = [];
    pc.onicecandidate = (e) => candidates.push(e.candidate ? { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } : null);
    pc.gather(${JSON.stringify(SDP)});
    return { candidates, sdp: pc.localDescription.sdp, sdp2Same: pc.localDescription === pc.localDescription };
  })()`, ctx);
}

describe('webrtcSpoofScript', () => {
  it('có máy chủ STUN: trang thấy ứng viên mDNS, ứng viên srflx mang IP proxy, rồi kết thúc', () => {
    const r = gather(browser(), "{ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }");
    expect(r.candidates).toHaveLength(3);
    const [host, srflx, end] = r.candidates;
    expect(host).toMatchObject({ sdpMid: '0', sdpMLineIndex: 0 });
    expect(String(host!.candidate)).toMatch(/^candidate:\d+ 1 udp 2113937151 [0-9a-f-]{36}\.local \d+ typ host generation 0 ufrag abcd network-cost 999$/);
    expect(String(srflx!.candidate)).toMatch(/^candidate:\d+ 1 udp 1677729535 203\.0\.113\.7 \d+ typ srflx raddr 0\.0\.0\.0 rport 0 generation 0 ufrag abcd network-cost 999$/);
    expect(end).toBeNull();
  });

  it('SDP của localDescription khớp với ứng viên đã báo, và giữ nguyên đối tượng giữa các lần đọc', () => {
    const r = gather(browser(), "{ iceServers: [{ urls: ['stun:a.example:3478'] }] }");
    const srflxPort = String(r.candidates[1]!.candidate).split(' ')[5];
    const lines = r.sdp.split('\r\n');
    expect(lines).toContain(`m=application ${srflxPort} UDP/DTLS/SCTP webrtc-datachannel`);
    expect(lines).toContain('c=IN IP4 203.0.113.7');
    const cands = lines.filter((l) => l.startsWith('a=candidate:'));
    expect(cands).toHaveLength(2);
    expect(cands[1]).toContain(`203.0.113.7 ${srflxPort} typ srflx`);
    expect(cands.join()).not.toContain('ufrag');
    expect(lines.indexOf(cands[0])).toBe(lines.indexOf('c=IN IP4 203.0.113.7') + 1);
    expect(r.sdp2Same).toBe(true);
  });

  it('không có máy chủ STUN: chỉ có ứng viên mDNS, như Chrome thật', () => {
    const r = gather(browser(), '{}');
    expect(r.candidates).toHaveLength(2);
    expect(String(r.candidates[0]!.candidate)).toContain('.local');
    expect(r.candidates[1]).toBeNull();
    expect(r.sdp).toContain('c=IN IP4 0.0.0.0');
    expect(r.sdp).not.toContain('203.0.113.7');
  });

  it('setConfiguration thêm STUN thì SDP có thêm srflx', () => {
    const ctx = browser();
    const sdp = vm.runInContext(`(() => {
      const pc = new RTCPeerConnection();
      pc.gather(${JSON.stringify(SDP)});
      pc.setConfiguration({ iceServers: [{ urls: 'turn:t.example', username: 'u', credential: 'c' }] });
      return pc.localDescription.sdp;
    })()`, ctx);
    expect(sdp).toContain('203.0.113.7');
  });

  it('IP proxy dạng IPv6', () => {
    const r = gather(browser('2001:db8::5'), "{ iceServers: [{ urls: 'stun:x' }] }");
    expect(String(r.candidates[1]!.candidate)).toContain('2001:db8::5');
    expect(r.sdp).toContain('c=IN IP6 2001:db8::5');
  });

  it('hàm bị bọc trông như hàm gốc', () => {
    const ctx = browser();
    const r = vm.runInContext(`({
      pc: Function.prototype.toString.call(RTCPeerConnection) === before.pc,
      pcString: String(RTCPeerConnection) === before.pc,
      ts: Function.prototype.toString.call(Function.prototype.toString) === before.ts,
      getter: Function.prototype.toString.call(Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'localDescription').get) === before.getter,
      name: RTCPeerConnection.name,
      ctor: RTCPeerConnection.prototype.constructor === RTCPeerConnection,
      inst: new RTCPeerConnection() instanceof RTCPeerConnection,
      alias: webkitRTCPeerConnection === RTCPeerConnection,
      keys: Object.keys(globalThis).includes('RTCPeerConnection'),
      noNew: (() => { try { RTCPeerConnection(); return false; } catch (e) { return e instanceof TypeError; } })(),
    })`, ctx);
    expect(r).toEqual({ pc: true, pcString: true, ts: true, getter: true, name: 'RTCPeerConnection', ctor: true, inst: true, alias: true, keys: true, noNew: true });
  });

  it('trang không có WebRTC thì không lỗi', () => {
    const ctx = vm.createContext({ Event, EventTarget });
    expect(() => vm.runInContext(webrtcSpoofScript('1.2.3.4'), ctx)).not.toThrow();
  });

  it('chỉ nhận địa chỉ IP hợp lệ, không chèn được mã vào script', () => {
    expect(() => webrtcSpoofScript("1.2.3.4'; alert(1); '")).toThrow('IP proxy không hợp lệ');
    expect(() => webrtcSpoofScript('')).toThrow();
    expect(webrtcSpoofScript('1.2.3.4')).toContain('const IP = "1.2.3.4";');
  });
});
