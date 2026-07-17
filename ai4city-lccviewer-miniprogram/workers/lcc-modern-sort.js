'use strict';

const lccScope = { onmessage: null };

function postMessage(message) {
  worker.postMessage(message);
}

function Xx(t){const e=new Map;let i=new Int32Array(1e5),s=new Int32Array(1e6),f=new Int32Array(0);function n(t,e,i){return Number.isFinite(t)?t<e?e:t>i?i:t:1e4}function r(t){const r=t.data.workerIndex,a=t.data.enableDepthSorting,o=t.data.splatCount,h=t.data.camPos,l=t.data.camForward,c=new Int32Array(t.data.idArrayBuffer),d=t.data.intervalsArray||[];f.length!==o&&(f=new Int32Array(o));a?function(t,r,a,o,h,l){s.length<t&&(s=new Int32Array(t+1e6));let c=Number.MAX_SAFE_INTEGER,u=-Number.MAX_SAFE_INTEGER;const d=e.get(o[0]),f=r.x-d[0],p=r.y-d[1],m=r.z-d[2],g=-1e3*Math.sqrt(f*f+p*p+m*m);let v=0;for(let i=0;i<o.length;++i){const t=e.get(o[i]),l=t.length/3,d=h[i]&&h[i].length>0?h[i]:[0,l];for(let e=0;e<d.length;e+=2){const i=d[e],o=d[e+1];for(let e=i;e<o;++e){let i=r.x-t[3*e],o=r.y-t[3*e+1],h=r.z-t[3*e+2],l=-1e3*Math.abs(i*a.x+o*a.y+h*a.z),d=Math.round(l-g);d=n(d,-25e6,25e6),d>u&&(u=d),d<c&&(c=d),s[v++]=d}}}v!=t&&console.error("offset error ...................",v,t);const y=u-c+1;i.length<y?i=new Int32Array(y):i.fill(0,0,y);for(let e=0;e<t;e++){const t=s[e]-c;i[t]++}for(let e=1;e<y;++e)i[e]+=i[e-1];for(let e=t-1;e>=0;--e){const t=s[e]-c;i[t]--,l[i[t]]=e}}(o,h,l,c,d,f):function(t,r,a,o,h){s.length<t&&(s=new Int32Array(t+1e6));let l=Number.MAX_SAFE_INTEGER,c=-Number.MAX_SAFE_INTEGER;const u=e.get(a[0]),d=r.x-u[0],f=r.y-u[1],p=r.z-u[2],m=-1e3*Math.sqrt(d*d+f*f+p*p);let g=0;for(let i=0;i<a.length;++i){const t=e.get(a[i]),h=t.length/3,u=o[i]&&o[i].length>0?o[i]:[0,h];for(let e=0;e<u.length;e+=2){const i=u[e],a=u[e+1];for(let e=i;e<a;++e){let i=r.x-t[3*e],a=r.y-t[3*e+1],o=r.z-t[3*e+2],h=-1e3*Math.sqrt(i*i+a*a+o*o),u=Math.round(h-m);u=n(u,-25e6,25e6),u>c&&(c=u),u<l&&(l=u),s[g++]=u}}}g!=t&&console.error("offset error ...................",g,t);const v=c-l+1;i.length<v?i=new Int32Array(v):i.fill(0,0,v);for(let e=0;e<t;e++){const t=s[e]-l;i[t]++}for(let e=1;e<v;++e)i[e]+=i[e-1];for(let e=t-1;e>=0;--e){const t=s[e]-l;i[t]--,h[i[t]]=e}}(o,h,c,d,f),postMessage({workerIndex:r,indexesBuffer:f.buffer,idArrayBuffer:t.data.idArrayBuffer},[f.buffer,t.data.idArrayBuffer])}function a(t,i){const s=new Float32Array(i);e.set(t,s)}function o(t){e.delete(t)}lccScope.onmessage=t=>{switch(t.data.type){case"sss":r(t);break;case"add":{const e=t.data.param;a(e.id,e.centerBuffer);break}case"addMany":{const e=t.data.param;for(let t=0;t<e.length;++t){const i=e[t];a(i.id,i.centerBuffer)}break}case"remove":o(t.data.param);break;case"removeMany":{const e=new Int32Array(t.data.param);for(let t=0;t<e.length;++t)o(e[t]);break}}}}

Xx(lccScope);
worker.onMessage((data) => {
  if (typeof lccScope.onmessage === 'function') {
    lccScope.onmessage({ data });
  }
});
