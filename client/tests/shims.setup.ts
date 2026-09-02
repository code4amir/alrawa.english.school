// Node-env shims for jsPDF + stores under vitest
const noop = () => {};
const _btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
const _atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
(globalThis as any).window = { addEventListener: noop, removeEventListener: noop, navigator: globalThis.navigator, location: { href: 'https://localhost.test/', protocol: 'https:', host: 'localhost.test', origin: 'https://localhost.test' }, btoa: _btoa, atob: _atob };
(globalThis as any).localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
(globalThis as any).document = { documentElement: { classList: { add: noop, remove: noop } } };
(globalThis as any).location = { href: 'https://localhost.test/', protocol: 'https:', host: 'localhost.test', origin: 'https://localhost.test' };
if (typeof (globalThis as any).btoa !== 'function') (globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
if (typeof (globalThis as any).atob !== 'function') (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
