const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mobileModules,deferred,tick}=require('./helpers.cjs');
function setup(token=async()=> 'valid',request=async()=>{}) {
 let listener;let active=true;let removed=false;let reads=0;
 const timers=[];
 const state={currentState:'active',addEventListener:(_,fn)=>{listener=fn;return{remove:()=>{removed=true;}};}};
 const load=mobileModules({'react-native':{AppState:state},'src/api/client.ts':{getValidToken:token,apiClient:{get:async path=>{reads++;assert.equal(path,'/session');await request();}}},'src/lib/sessionScope.ts':{sessionGuard:()=>()=>active}}, {setTimeout:(fn,ms)=>{assert.equal(ms,60000);timers.push(fn);return timers.length;},clearTimeout:()=>{}});
 const stop=load('src/services/sessionHealth.ts').startSessionHealth();
 return {stop,state,timers,get reads(){return reads;},get removed(){return removed;},resume:()=>listener('active'),changeSession:()=>{active=false;}};
}
test('checks authentication on startup, resume and periodic ticks',async()=>{
 const ui=setup();await tick();assert.equal(ui.reads,1);
 ui.timers.shift()();await tick();assert.equal(ui.reads,2);
 ui.resume();await tick();assert.equal(ui.reads,3);
 ui.stop();assert.equal(ui.removed,true);
});
test('a transient failure retries without overlapping a pending check',async()=>{
 const gate=deferred();let calls=0;
 const ui=setup(async()=>{calls++;if(calls===1){await gate.promise;throw new Error('offline');}return 'valid';});
 ui.resume();await tick();assert.equal(calls,1);
 gate.resolve();await tick();assert.equal(ui.reads,0);
 ui.timers.shift()();await tick();assert.equal(ui.reads,1);ui.stop();
});
test('stopping or changing accounts prevents a pending check from reaching the new session',async()=>{
 for(const action of ['stop','changeSession']){
  const gate=deferred();const ui=setup(()=>gate.promise);ui[action]();gate.resolve('old-token');await tick();assert.equal(ui.reads,0);assert.equal(ui.timers.length,0);ui.stop();
 }
});
test('background and expired sessions do not send authenticated requests',async()=>{
 const ui=setup(async()=> '');await tick();assert.equal(ui.reads,0);
 ui.state.currentState='background';ui.timers.shift()();await tick();assert.equal(ui.reads,0);ui.stop();
});
