import net from 'node:net';

/**
 * Script chạy trong mọi trang và iframe trước script của trang, khi hồ sơ dùng proxy.
 *
 * Nhân chặn UDP không đi qua proxy nên WebRTC thật không tìm được ứng viên nào, và trang không thấy IP nào.
 * Script bọc RTCPeerConnection để trang thấy giống Chrome thật đứng sau IP của proxy:
 * một ứng viên "host" dạng mDNS (xxxx.local, như Chrome vẫn ẩn IP nội bộ), và khi trang có cấu hình
 * máy chủ STUN/TURN thì thêm một ứng viên "srflx" mang IP proxy. SDP của localDescription cũng khớp theo.
 * Không có kết nối thật nào được tạo ra, nên không có gì để lộ IP thật.
 *
 * Các hàm bị bọc là Proxy của hàm gốc, và Function.prototype.toString trả đúng chuỗi của hàm gốc.
 */
const SOURCE = String.raw`(() => {
  'use strict';
  const IP = __BF_IP__;
  const G = globalThis;
  const Native = G.RTCPeerConnection;
  if (typeof Native !== 'function') return;
  const NativeCandidate = G.RTCIceCandidate;
  const NativeIceEvent = G.RTCPeerConnectionIceEvent;
  const NativeDesc = G.RTCSessionDescription;
  const FnProto = G.Function.prototype;
  const nativeToString = FnProto.toString;
  const addListener = G.EventTarget.prototype.addEventListener;
  const dispatch = G.EventTarget.prototype.dispatchEvent;
  const apply = G.Reflect.apply;
  const construct = G.Reflect.construct;
  const getDesc = G.Object.getOwnPropertyDescriptor;
  const defineProp = G.Object.defineProperty;
  const isV6 = IP.indexOf(':') !== -1;

  const nativeText = new G.WeakMap();
  const masked = (wrapper, original) => {
    nativeText.set(wrapper, apply(nativeToString, original, []));
    return wrapper;
  };
  const toStringProxy = new G.Proxy(nativeToString, {
    apply(target, self, args) {
      const text = nativeText.get(self);
      return text !== undefined ? text : apply(target, self, args);
    },
  });
  masked(toStringProxy, nativeToString);
  const tsDesc = getDesc(FnProto, 'toString');
  defineProp(FnProto, 'toString', { ...tsDesc, value: toStringProxy });

  const states = new G.WeakMap();
  const synthetic = new G.WeakSet();
  const patchedDescs = new G.WeakMap();

  const rand = (min, max) => min + G.Math.floor(G.Math.random() * (max - min + 1));
  const uuid = () => {
    if (G.crypto && typeof G.crypto.randomUUID === 'function') return G.crypto.randomUUID();
    const h = () => rand(0, 0xffff).toString(16).padStart(4, '0');
    return h() + h() + '-' + h() + '-4' + h().slice(1) + '-' + (8 + rand(0, 3)).toString(16) + h().slice(1) + '-' + h() + h() + h();
  };

  const hasIceServers = (config) => {
    const servers = config && config.iceServers;
    if (!servers || typeof servers.length !== 'number') return false;
    for (let i = 0; i < servers.length; i++) {
      const s = servers[i];
      if (!s) continue;
      const urls = s.urls !== undefined ? s.urls : s.url;
      const list = typeof urls === 'string' ? [urls] : urls && typeof urls.length === 'number' ? urls : [];
      for (let j = 0; j < list.length; j++) if (/^(stuns?|turns?):/i.test(String(list[j]))) return true;
    }
    return false;
  };

  const descGetter = (name) => {
    const d = getDesc(Native.prototype, name);
    return d && d.get;
  };
  const nativeLocal = descGetter('localDescription');
  const nativeGathering = descGetter('iceGatheringState');

  /** Phần media đầu tiên của SDP: ICE của mọi kênh gộp chung (bundle) vào đây, như Chrome. */
  const firstSection = (lines) => {
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('m=') === 0) {
        if (start === -1) start = i;
        else {
          end = i;
          break;
        }
      }
    }
    return { start, end };
  };

  const fakeFor = (pc, st) => {
    const desc = nativeLocal ? apply(nativeLocal, pc, []) : null;
    if (!desc || !desc.sdp) return null;
    const lines = desc.sdp.split('\r\n');
    const sec = firstSection(lines);
    if (sec.start === -1) return null;
    let ufrag = null;
    let mid = null;
    for (let i = sec.start; i < sec.end; i++) {
      if (lines[i].indexOf('a=ice-ufrag:') === 0) ufrag = lines[i].slice(12);
      else if (lines[i].indexOf('a=mid:') === 0) mid = lines[i].slice(6);
    }
    if (!ufrag) return null;
    if (st.fake && st.fake.ufrag === ufrag && st.fake.withSrflx === st.servers) return st.fake;
    const old = st.fake && st.fake.ufrag === ufrag ? st.fake : null;
    const hostPort = old ? old.hostPort : rand(49152, 65535);
    const srflxPort = old ? old.srflxPort : rand(49152, 65535);
    const host = (old ? old.hostFoundation : rand(1e9, 4294967295)) + ' 1 udp 2113937151 ' + (old ? old.mdns : uuid()) + '.local ' + hostPort + ' typ host generation 0';
    const fake = {
      ufrag,
      mid,
      withSrflx: st.servers,
      hostPort,
      srflxPort,
      hostFoundation: old ? old.hostFoundation : G.Number(host.split(' ')[0]),
      mdns: old ? old.mdns : host.split(' ')[4].replace(/\.local$/, ''),
      sdpLines: ['a=candidate:' + host + ' network-cost 999'],
      candidates: ['candidate:' + host + ' ufrag ' + ufrag + ' network-cost 999'],
    };
    if (st.servers) {
      const srflx = rand(1e9, 4294967295) + ' 1 udp ' + (isV6 ? '1677732095' : '1677729535') + ' ' + IP + ' ' + srflxPort + ' typ srflx raddr ' + (isV6 ? '::' : '0.0.0.0') + ' rport 0 generation 0';
      fake.sdpLines.push('a=candidate:' + srflx + ' network-cost 999');
      fake.candidates.push('candidate:' + srflx + ' ufrag ' + ufrag + ' network-cost 999');
    }
    st.fake = fake;
    return fake;
  };

  const patchSdp = (sdp, fake) => {
    const lines = sdp.split('\r\n');
    const sec = firstSection(lines);
    if (sec.start === -1) return sdp;
    let at = sec.start + 1;
    for (let i = sec.start + 1; i < sec.end; i++) {
      if (lines[i].indexOf('c=') === 0) at = i + 1;
      else if (lines[i].indexOf('a=rtcp:') === 0) at = i + 1;
      else if (lines[i].indexOf('a=candidate:') === 0) return sdp;
    }
    if (fake.withSrflx) {
      const addr = (isV6 ? 'IN IP6 ' : 'IN IP4 ') + IP;
      const m = lines[sec.start].split(' ');
      m[1] = String(fake.srflxPort);
      lines[sec.start] = m.join(' ');
      for (let i = sec.start + 1; i < sec.end; i++) {
        if (lines[i].indexOf('c=') === 0) lines[i] = 'c=' + addr;
        else if (lines[i].indexOf('a=rtcp:') === 0) lines[i] = 'a=rtcp:' + fake.srflxPort + ' ' + addr;
      }
    }
    lines.splice(at, 0, ...fake.sdpLines);
    return lines.join('\r\n');
  };

  const fire = (pc, candidate) => {
    const ev = new NativeIceEvent('icecandidate', { candidate });
    synthetic.add(ev);
    apply(dispatch, pc, [ev]);
  };

  const setup = (pc, config) => {
    const st = { servers: hasIceServers(config), fake: null };
    states.set(pc, st);
    apply(addListener, pc, [
      'icecandidate',
      (e) => {
        if (synthetic.has(e) || e.candidate) return;
        const fake = fakeFor(pc, st);
        if (!fake) return;
        e.stopImmediatePropagation();
        for (let i = 0; i < fake.candidates.length; i++) {
          fire(pc, new NativeCandidate({ candidate: fake.candidates[i], sdpMid: fake.mid, sdpMLineIndex: 0, usernameFragment: fake.ufrag }));
        }
        fire(pc, null);
      },
    ]);
  };

  const wrapLocalGetter = (name) => {
    const d = getDesc(Native.prototype, name);
    if (!d || !d.get) return;
    const get = masked(
      new G.Proxy(d.get, {
        apply(target, self, args) {
          const desc = apply(target, self, args);
          const st = states.get(self);
          if (!desc || !st || !desc.sdp || !nativeGathering || apply(nativeGathering, self, []) !== 'complete') return desc;
          const fake = fakeFor(self, st);
          if (!fake) return desc;
          const cached = patchedDescs.get(desc);
          if (cached && cached.fake === fake) return cached.desc;
          const patched = new NativeDesc({ type: desc.type, sdp: patchSdp(desc.sdp, fake) });
          patchedDescs.set(desc, { fake, desc: patched });
          return patched;
        },
      }),
      d.get,
    );
    defineProp(Native.prototype, name, { ...d, get });
  };
  wrapLocalGetter('localDescription');
  wrapLocalGetter('currentLocalDescription');
  wrapLocalGetter('pendingLocalDescription');

  const sc = getDesc(Native.prototype, 'setConfiguration');
  if (sc && typeof sc.value === 'function') {
    const value = masked(
      new G.Proxy(sc.value, {
        apply(target, self, args) {
          const r = apply(target, self, args);
          const st = states.get(self);
          if (st) st.servers = hasIceServers(args[0]);
          return r;
        },
      }),
      sc.value,
    );
    defineProp(Native.prototype, 'setConfiguration', { ...sc, value });
  }

  const Wrapped = masked(
    new G.Proxy(Native, {
      construct(target, args, newTarget) {
        const pc = construct(target, args, newTarget === Wrapped ? target : newTarget);
        try {
          setup(pc, args[0]);
        } catch (_) {
          // không làm hỏng trang nếu có gì bất thường
        }
        return pc;
      },
    }),
    Native,
  );
  const ctorDesc = getDesc(Native.prototype, 'constructor');
  if (ctorDesc) defineProp(Native.prototype, 'constructor', { ...ctorDesc, value: Wrapped });
  const replaceGlobal = (name) => {
    const d = getDesc(G, name);
    if (d && d.value === Native) defineProp(G, name, { ...d, value: Wrapped });
  };
  replaceGlobal('RTCPeerConnection');
  replaceGlobal('webkitRTCPeerConnection');
})();`;

/** Script giả WebRTC cho IP proxy `ip`. Ném lỗi nếu `ip` không phải địa chỉ IP hợp lệ. */
export function webrtcSpoofScript(ip: string): string {
  if (net.isIP(ip) === 0) throw new Error('IP proxy không hợp lệ');
  return SOURCE.replace('__BF_IP__', JSON.stringify(ip));
}
