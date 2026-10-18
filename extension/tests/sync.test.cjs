const {test}=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../shared/core.js');
const {Engine,POLL_MINUTES}=require('../shared/engine.js');
const {copy,empty,bookmark,fixture,server}=require('./helpers.cjs');
function setup(firefox=false,tree=empty()) {
  const mock=fixture(firefox), remote=server(tree), timers=[];
  const engine=new Engine(mock.api,{browser:firefox?{}:null,fetch:remote.fetch,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
  return {...mock,remote,engine,timers};
}
async function bind(s,tree) {if(tree)s.remote.set(tree);await s.engine.bind('http://localhost:8080','research',s.remote.get());}
const rich=()=>({roots:{toolbar:[bookmark('one'),{type:'folder',title:'Nested',children:[bookmark('two'),{type:'folder',title:'Empty',children:[]}]},bookmark('three')],menu:[bookmark('menu')],other:[bookmark('other')],mobile:[bookmark('mobile')]}});

test('Chrome restores hierarchy, exact ordering, empty folders, preserves permanent roots and round trips to Firefox',async()=>{
  const chrome=setup();await bind(chrome,rich());
  assert.deepEqual(await chrome.engine.localTree(),rich());
  assert.equal(chrome.root.children.length,2);
  assert.ok(chrome.calls.removed.every(id=>!Object.values(chrome.ids).includes(id)));
  const firefox=setup(true);await bind(firefox,await chrome.engine.localTree());
  assert.deepEqual(await firefox.engine.localTree(),rich());
  await bind(chrome,await firefox.engine.localTree());assert.deepEqual(await chrome.engine.localTree(),rich());
});
test('root recognition never treats a user folder named Other bookmarks as a permanent root',async()=>{
  const s=setup();await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'Other bookmarks'});
  const child=s.find(s.ids.toolbar).children[0];await s.api.bookmarks.create({parentId:child.id,title:'keep',url:'https://example.com'});
  const local=await s.engine.localTree();assert.equal(local.roots.toolbar[0].title,'Other bookmarks');assert.equal(local.roots.other.length,0);
  await bind(s);assert.equal(s.find(s.ids.toolbar).children.length,0);
});
test('named missing profile auto-seeds current nested bookmarks only after connection',async()=>{
  const s=setup();
  const nested=await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'Nested'});
  await s.api.bookmarks.create({parentId:nested.id,title:'Saved',url:'https://example.com/saved'});
  const tree=await s.engine.localTree();let profile=null;const calls=[];
  s.engine.fetch=async(url,options={})=>{
    calls.push(options.method||'GET');let status=200,body;
    if(url.endsWith('/health'))body={status:'ok'};
    else if(url.endsWith('/profiles'))body={profiles:[]};
    else if(options.method==='POST'){const input=JSON.parse(options.body);profile={schema_version:1,name:'fresh',updated_at:44,tree:input.tree};status=201;body=profile;}
    else if(!profile){status=404;body={detail:'Profile not found'};}
    else body=profile;
    return{ok:status<400,status,json:async()=>body};
  };
  await assert.rejects(s.engine.selectProfile('http://localhost:8080','fresh'),/Connect/);
  await s.engine.connect('http://localhost:8080');
  const result=await s.engine.selectProfile('http://localhost:8080','fresh');
  assert.equal(result.created,true);assert.deepEqual(profile.tree,tree);assert.equal(s.state().profile,'fresh');assert.equal(s.state().auto,true);
  assert.deepEqual(calls,['GET','GET','GET','POST']);
  assert.equal(POLL_MINUTES,5);assert.ok(Object.values(s.calls.alarms).some(alarm=>alarm.periodInMinutes===5));
});
test('missing-profile check does not create on server errors and handles concurrent creation as existing',async()=>{
  const failed=setup();await failed.engine.connect('http://localhost:8080');let posts=0;
  failed.engine.fetch=async (url,options={})=>{if(options.method==='POST')posts++;return url.endsWith('/health')?{ok:true,status:200,json:async()=>({})}:url.endsWith('/profiles')?{ok:true,status:200,json:async()=>({profiles:[]})}:{ok:false,status:500,json:async()=>({detail:'disk error'})};};
  await assert.rejects(failed.engine.selectProfile('http://localhost:8080','fresh'),/disk error/);assert.equal(posts,0);

  const raced=setup();await raced.engine.connect('http://localhost:8080');let profile=null,firstGet=true;
  raced.engine.fetch=async(url,options={})=>{
    if(url.endsWith('/health'))return{ok:true,status:200,json:async()=>({})};
    if(url.endsWith('/profiles'))return{ok:true,status:200,json:async()=>({profiles:[]})};
    if(options.method==='POST'){profile={schema_version:1,name:'fresh',updated_at:55,tree:empty()};return{ok:false,status:409,json:async()=>({detail:'already exists'})};}
    if(firstGet){firstGet=false;return{ok:false,status:404,json:async()=>({detail:'missing'})};}
    return{ok:true,status:200,json:async()=>profile};
  };
  const result=await raced.engine.selectProfile('http://localhost:8080','fresh');assert.equal(result.created,false);assert.equal(result.serverCount,0);assert.equal(raced.state().profile,null);
});
test('remote apply does not cause repeated uploads even with delayed bookmark events',async()=>{
  const s=setup();s.engine.startEvents();await bind(s,rich());
  await s.engine.onBookmarkEvent();await s.engine.sync();await s.engine.sync();
  assert.equal(s.remote.calls.filter(c=>c.options.method==='PUT').length,0);
});
test('pending offline edits survive worker restart, retry and only changed tree uploads',async()=>{
  const s=setup();await bind(s);
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'offline',url:'https://example.com/offline'});
  await s.engine.onBookmarkEvent();s.remote.offline(true);
  await assert.rejects(s.engine.sync(),/offline/);assert.equal(s.state().dirty,true);
  s.remote.offline(false);
  const restarted=new Engine(s.api,{browser:null,fetch:s.remote.fetch,setTimeout:()=>1,clearTimeout:()=>{}});
  await restarted.sync();assert.equal(Core.count(s.remote.get().tree),1);assert.equal(s.state().dirty,false);
  await restarted.sync();assert.equal(s.remote.calls.filter(c=>c.options.method==='PUT').length,1);
});
test('poll detects missed events after suspension using saved baseline',async()=>{
  const s=setup();await bind(s);
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'missed',url:'https://example.com/missed'});
  assert.equal(s.state().dirty,false);await s.engine.sync();assert.equal(Core.count(s.remote.get().tree),1);
});
test('newer server tree wins and pending local tree is preserved',async()=>{
  const s=setup();await bind(s);
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'pending',url:'https://example.com/pending'});await s.engine.onBookmarkEvent();
  const remote=empty();remote.roots.other=[bookmark('server')];s.remote.set(remote);
  await s.engine.sync();assert.deepEqual(await s.engine.localTree(),remote);assert.equal(s.state().dirty,false);
  assert.ok(s.state().backups.some(b=>b.tree.roots.toolbar.some(n=>n.title==='pending')));
  assert.match(s.state().status,/conflict|server/i);
});
test('HTTP409 race preserves pending snapshot and applies newer server state without loop',async()=>{
  const s=setup();await bind(s);
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'race',url:'https://example.com/race'});await s.engine.onBookmarkEvent();s.remote.conflict();
  try{await s.engine.sync();}catch(e){assert.equal(e.status,409);}
  assert.deepEqual(await s.engine.localTree(),s.remote.get().tree);
  assert.ok(s.state().backups.some(b=>Core.count(b.tree)===1));await s.engine.sync();
  assert.equal(s.remote.calls.filter(c=>c.options.method==='PUT').length,1);
});
test('partial restore failure blocks uploading and recovery restores original tree',async()=>{
  const s=setup();await bind(s);
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'original',url:'https://example.com/original'});
  const original=await s.engine.localTree();s.api.failCreate=true;
  await assert.rejects(bind(s,rich()),/creation/);assert.ok(s.state().restore);assert.equal(s.state().auto,false);
  await assert.rejects(s.engine.sync(),/recover/i);s.api.failCreate=false;
  await s.engine.recover();assert.deepEqual(await s.engine.localTree(),original);assert.equal(s.state().auto,false);assert.equal(s.state().profile,null);
});
test('unknown and managed roots refuse replacement before deleting local contents',async()=>{
  for(const kind of ['unknown','managed','duplicate']) {
    const s=setup();await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'keep',url:'https://example.com'});
    s.root.children.push(kind==='managed'?{id:'managed',title:'Managed',unmodifiable:'managed',children:[]}:kind==='duplicate'?{id:'99',folderType:'bookmarks-bar',title:'Account bar',children:[]}:{id:'99',title:'Unknown',children:[]});
    await assert.rejects(bind(s,rich()));assert.equal(s.calls.removed.length,0);assert.equal(s.find(s.ids.toolbar).children[0].title,'keep');
  }
});
test('turning auto off retains local edits for explicit Sync now',async()=>{
  const s=setup();await bind(s);await s.engine.save({auto:false});await s.engine.configureAlarm(false);
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'manual',url:'https://example.com'});await s.engine.onBookmarkEvent();
  await s.engine.sync();assert.equal(Core.count(s.remote.get().tree),1);
});
test('switching collection replaces local tree and keeps the prior snapshot',async()=>{
  const s=setup();await bind(s,rich());const old=await s.engine.localTree();
  const next=empty();next.roots.other=[bookmark('work')];const profile={...s.remote.get(),name:'work',tree:next,updated_at:2000};
  await s.engine.bind('http://localhost:8080','work',profile);assert.equal(s.state().profile,'work');assert.deepEqual(await s.engine.localTree(),next);assert.ok(s.state().backups.some(b=>Core.equal(b.tree,old)));
});
test('invalid recovery file and remote profile never clear any local bookmarks',async()=>{
  const s=setup();await bind(s,rich());const before=await s.engine.localTree();
  for(const invalid of [{}, {roots:{}}, {roots:{...empty().roots,toolbar:[{type:'bookmark',title:'bad',url:17}]}}]) {
    await assert.rejects(s.engine.importBackup(invalid));assert.deepEqual(await s.engine.localTree(),before);
  }
  const original=s.engine.fetch;s.engine.fetch=async()=>({ok:true,status:200,json:async()=>({schema_version:2,name:'research',updated_at:4000,tree:empty()})});
  await assert.rejects(s.engine.sync(),/invalid/i);assert.deepEqual(await s.engine.localTree(),before);s.engine.fetch=original;
});
test('Firefox native separator survives Chrome fallback and roundtrip',async()=>{
  const tree=rich();tree.roots.toolbar.splice(1,0,{type:'separator'});
  const firefox=setup(true);await bind(firefox,tree);
  assert.equal(firefox.find(firefox.ids.toolbar).children[1].type,'separator');
  const chrome=setup();await bind(chrome,await firefox.engine.localTree());assert.deepEqual(await chrome.engine.localTree(),tree);
  await bind(firefox,await chrome.engine.localTree());assert.deepEqual(await firefox.engine.localTree(),tree);
});
test('auto off prevents an already queued debounce or stale alarm from syncing',async()=>{
  const s=setup();await bind(s);
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'pending',url:'https://example.com'});await s.engine.onBookmarkEvent();
  const timer=s.timers.at(-1);await s.engine.setAuto(false);timer();await s.engine.serial;
  await s.engine.onAlarm({name:'bookmarksman-poll'});await s.engine.serial;
  assert.equal(s.remote.calls.filter(c=>c.options.method==='PUT').length,0);
});
test('failed recovery retries preserve the original recovery target',async()=>{
  const s=setup();await bind(s);await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'original',url:'https://example.com'});
  const original=await s.engine.localTree();s.api.failCreate=true;await assert.rejects(bind(s,rich()));
  for(let i=0;i<12;i++)await assert.rejects(s.engine.recover());
  s.api.failCreate=false;await s.engine.recover();assert.deepEqual(await s.engine.localTree(),original);
});
test('a user adds bookmarks inside a separator marker folder without silent loss',async()=>{
  const s=setup();const tree=empty();tree.roots.toolbar=[{type:'separator'}];await bind(s,tree);
  const placeholder=s.find(s.ids.toolbar).children[0];
  await s.api.bookmarks.create({parentId:placeholder.id,title:'preserve me',url:'https://example.com'});
  const local=await s.engine.localTree();assert.equal(Core.count(local),1);
});
test('conflict resolution completes before a queued profile switch',async()=>{
  const s=setup();await bind(s);await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'pending',url:'https://example.com'});await s.engine.onBookmarkEvent();
  let release,started;
  const gate=new Promise(resolve=>release=resolve),writing=new Promise(resolve=>started=resolve);
  const request=s.engine.fetch;
  s.engine.fetch=async(url,options={})=>{
    if(options.method==='PUT'){started();await gate;s.remote.conflict();}
    return request(url,options);
  };
  const syncing=s.engine.sync();await writing;
  const work=empty();work.roots.toolbar=[bookmark('work')];
  const switching=s.engine.bind('http://localhost:8080','work',{schema_version:1,name:'work',tree:work,updated_at:2000});
  release();await Promise.all([syncing,switching]);
  assert.equal(s.state().profile,'work');assert.deepEqual(await s.engine.localTree(),work);
});
test('native import events defer automatic synchronization until the complete tree is available',async()=>{
  const s=setup();await bind(s);s.engine.startEvents();s.event('onImportBegan');await s.engine.serial;
  await s.api.bookmarks.create({parentId:s.ids.toolbar,title:'importing',url:'https://example.com'});await s.engine.serial;
  await s.engine.sync(true);assert.equal(s.remote.calls.filter(c=>c.options.method==='PUT').length,0);
  s.event('onImportEnded');await s.engine.serial;await s.engine.sync(true);
  assert.equal(Core.count(s.remote.get().tree),1);
});
test('Firefox Window timers retain their receiver during connect and profile binding',async()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const mock=fixture(true),remote=server();
  const context=vm.createContext({URL,AbortController,api:mock.api,fetch:remote.fetch,timerCalls:0,clearCalls:0});
  vm.runInContext(`
    globalThis.setTimeout = function () {
      if (this !== globalThis) throw new TypeError("'setTimeout' called on an object that does not implement interface Window");
      timerCalls++; return timerCalls;
    };
    globalThis.clearTimeout = function () {
      if (this !== globalThis) throw new TypeError("'clearTimeout' called on an object that does not implement interface Window");
      clearCalls++;
    };
  `,context);
  for(const path of ['../shared/core.js','../shared/engine.js'])vm.runInContext(fs.readFileSync(require.resolve(path),'utf8'),context);
  await vm.runInContext(`globalThis.engine = new BMEngine.Engine(api, {browser: {}, fetch}); engine.connect('http://100.120.83.124:1024')`,context);
  assert.equal(mock.state().server,'http://100.120.83.124:1024');
  await vm.runInContext(`engine.profile('http://100.120.83.124:1024', 'research').then(profile => engine.bind('http://100.120.83.124:1024', 'research', profile))`,context);
  assert.equal(mock.state().profile,'research');
  assert.equal(mock.state().auto,true);assert.equal(remote.calls.filter(call=>call.options.method==='POST').length,0);
  const saved=await vm.runInContext(`new BMEngine.Engine(api, {browser: {}, fetch}).state()`,context);
  assert.equal(saved.server,'http://100.120.83.124:1024');assert.equal(saved.name,'research');
  assert.ok(context.timerCalls>=3);assert.equal(context.clearCalls,context.timerCalls);
});
