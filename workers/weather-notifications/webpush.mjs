// RFC 8291 aes128gcm payload encryption and RFC 8292 VAPID authentication.
const encoder = new TextEncoder();
export const encode = value => btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0));
const concat = (...parts) => new Uint8Array(parts.flatMap(part => Array.from(part)));
export async function hkdf(raw, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt, info}, key, length * 8));
}
export function validEndpoint(value) {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password && !url.port && (
      ['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com'].includes(url.hostname) ||
      url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com') || url.hostname.endsWith('.notify.live.net'));
  } catch (_) { return false; }
}
export async function validateSubscription(value) {
  if (!value || !validEndpoint(value.endpoint) || !/^[A-Za-z0-9_-]+$/.test(value.keys?.p256dh || '') || !/^[A-Za-z0-9_-]+$/.test(value.keys?.auth || '')) return false;
  try {
    if (decode(value.keys.p256dh).length !== 65 || decode(value.keys.auth).length !== 16) return false;
    await crypto.subtle.importKey('raw', decode(value.keys.p256dh), {name:'ECDH', namedCurve:'P-256'}, false, []);
    return true;
  } catch (_) { return false; }
}
export async function pushRequest(env, subscription, message) {
  if (!validEndpoint(subscription.endpoint)) throw Error('Invalid push endpoint');
  const remotePublic = decode(subscription.p256dh), auth = decode(subscription.auth);
  const pair = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const remote = await crypto.subtle.importKey('raw', remotePublic, {name:'ECDH', namedCurve:'P-256'}, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH', public:remote}, pair.privateKey, 256));
  const ikm = await hkdf(shared, auth, concat(encoder.encode('WebPush: info\0'), remotePublic, localPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);
  const payload = encoder.encode(JSON.stringify(message));
  if (payload.length > 3000) throw Error('Push message too large');
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce}, aes, concat(payload, [2])));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = localPublic.length;
  const head = encode(encoder.encode(JSON.stringify({typ:'JWT', alg:'ES256'})));
  const claims = encode(encoder.encode(JSON.stringify({aud:new URL(subscription.endpoint).origin, exp:Math.floor(Date.now()/1000)+3600, sub:'mailto:notifications@gregle.uk'})));
  const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE), {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']);
  const signature = encode(new Uint8Array(await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, privateKey, encoder.encode(head + '.' + claims))));
  return new Request(subscription.endpoint, {method:'POST', redirect:'error', signal:AbortSignal.timeout(10000), headers:{TTL:'300', Urgency:'normal', 'Content-Encoding':'aes128gcm', 'Content-Type':'application/octet-stream', Authorization:`vapid t=${head}.${claims}.${signature}, k=${env.VAPID_PUBLIC}`}, body:concat(header, localPublic, cipher)});
}
export async function send(env, subscription, message) { return fetch(await pushRequest(env, subscription, message)); }
