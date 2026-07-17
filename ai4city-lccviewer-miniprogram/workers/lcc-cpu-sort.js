'use strict';

const lccScope = { onmessage: null };

function postMessage(message) {
  worker.postMessage(message);
}

function co(t){const e=new Int32Array(1e5);lccScope.onmessage=t=>{const i=t.data.workerIndex,s=t.data.enableDepthSorting,n=t.data.splatCount,r=t.data.camPos,a=t.data.camForward,o=new Int32Array(t.data.indexesBuffer),h=new Int32Array(t.data.distancesBuffer),l=new Float32Array(t.data.transformsBuffer);s?function(t,i,s,n,r,a){let o=Number.MAX_SAFE_INTEGER,h=-Number.MAX_SAFE_INTEGER,l=i.x-a[0],c=i.y-a[1],u=i.z-a[2],d=-1e3*Math.sqrt(l*l+c*c+u*u);for(let e=0;e<t;e++){let t=i.x-a[3*e],n=i.y-a[3*e+1],l=i.z-a[3*e+2],c=-1e3*Math.abs(t*s.x+n*s.y+l*s.z),u=Math.round(c-d);u>h&&(h=u),u<o&&(o=u),r[e]=u}const f=h-o+1;let p;if(f<e.length){p=e;for(let t=0;t<f;++t)e[t]=0}else p=new Int32Array(f);for(let e=0;e<t;e++)p[r[e]-o]++;for(let e=1;e<p.length;++e)p[e]+=p[e-1];for(let e=r.length-1;e>=0;--e){const t=r[e]-o;p[t]--,n[p[t]]=e}}(n,r,a,o,h,l):function(t,i,s,n,r){let a=Number.MAX_SAFE_INTEGER,o=-Number.MAX_SAFE_INTEGER,h=i.x-r[0],l=i.y-r[1],c=i.z-r[2],u=-1e3*Math.sqrt(h*h+l*l+c*c);for(let e=0;e<t;e++){let t=i.x-r[3*e],s=i.y-r[3*e+1],h=i.z-r[3*e+2],l=-1e3*Math.sqrt(t*t+s*s+h*h),c=Math.round(l-u);c>o&&(o=c),c<a&&(a=c),n[e]=c}const d=o-a+1;let f;if(d<e.length){f=e;for(let t=0;t<d;++t)e[t]=0}else f=new Int32Array(d);for(let e=0;e<t;e++)f[n[e]-a]++;for(let e=1;e<f.length;++e)f[e]+=f[e-1];for(let e=n.length-1;e>=0;--e){const t=n[e]-a;f[t]--,s[f[t]]=e}}(n,r,o,h,l),postMessage({workerIndex:i,indexesBuffer:o.buffer,distancesBuffer:h.buffer,transformsBuffer:l.buffer},[o.buffer,h.buffer,l.buffer])}}

co(lccScope);
worker.onMessage((data) => {
  if (typeof lccScope.onmessage === 'function') {
    lccScope.onmessage({ data });
  }
});
