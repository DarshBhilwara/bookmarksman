const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {empty,bookmark}=require('./helpers.cjs');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
async function popup(state, sendMessage, confirm = () => true) {
  const elements=new Map(),downloads=[],grants=[];
  function element(id) {
    if(!elements.has(id)) {
      const item={value:'',textContent:'',checked:false,hidden:false,options:[],listeners:{},addEventListener(kind,fn){this.listeners[kind]=fn;},replaceChildren(){this.options=[];},append(option){this.options.push(option);},click(){},files:[]};
      if(id!=='profiles')item.add=function(option){this.options.push(option);};
      elements.set(id,item);
    }
    return elements.get(id);
  }
  class FakeURL extends URL {
    static createObjectURL(blob){downloads.push(blob);return 'blob:test';}
    static revokeObjectURL(){}
  }
  const context={
    chrome:{permissions:{request:async opts=>{grants.push(opts);return true;}},runtime:{sendMessage:async message=>sendMessage?sendMessage(message):({ok:true,value:message.action==='status'?structuredClone(state):message.action==='backups'?structuredClone(state.backups):{profiles:[]}})}},
    document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('anchor')},
    URL:FakeURL,Blob,Option:class{constructor(text,value){this.text=text;this.value=value;}},setTimeout:()=>1,confirm
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../popup.js'),'utf8'),context);
  await settle();
  return {element,downloads,grants};
}
test('popup reconnects saved server and renders binding and persisted sync errors',async()=>{
  const ui=await popup({server:'http://localhost:1024',name:'research',auto:false,status:'Restore failed',error:'disk offline',lastSync:1000,last_seen_server_updated_at:2000});
  assert.equal(ui.element('server').value,'http://localhost:1024');assert.match(ui.element('binding').textContent,/research/);assert.equal(ui.element('profileSection').hidden,false);
  assert.equal(ui.element('status').textContent,'Restore failed');assert.equal(ui.element('error').textContent,'disk offline');assert.equal(ui.element('auto').checked,false);
});
test('offline popup shows saved server and last synced profile without opening profile controls',async()=>{
  const remembered={server:'http://old-server:1024',profile:'research'};
  const state={serverSetting:'http://old-server:1024',lastSyncedBinding:remembered,status:'Sync failed',error:'offline'};
  const ui=await popup(state,async({action})=>action==='status'?{ok:true,value:structuredClone(state)}:{ok:false,error:'offline',status:0});
  assert.equal(ui.element('server').value,'http://old-server:1024');
  assert.equal(ui.element('name').value,'research');
  assert.match(ui.element('binding').textContent,/research/);assert.match(ui.element('binding').textContent,/old-server/);
  assert.equal(ui.element('profileSection').hidden,true);
  const different=await popup({...state,serverSetting:'http://new-server:1024'},async({action})=>action==='status'?{ok:true,value:{...state,serverSetting:'http://new-server:1024'}}:{ok:false,error:'offline',status:0});
  assert.equal(different.element('server').value,'http://new-server:1024');
  assert.equal(different.element('name').value,'');
  assert.match(different.element('binding').textContent,/research/);
});
test('recovery export contains the selected individual snapshot and can be reimported',async()=>{
  const one=empty(),two=empty();two.roots.toolbar=[bookmark('saved')];
  const state={backups:[{id:'1',created_at:1000,label:'first',tree:one},{id:'2',created_at:2000,label:'second',tree:two}]};
  const ui=await popup(state);assert.equal(ui.element('snapshots').options.length,2);ui.element('snapshots').value='2';
  await ui.element('export').onclick();assert.equal(ui.downloads.length,1);
  const data=JSON.parse(await ui.downloads[0].text());assert.equal(data.id,'2');assert.deepEqual(data.tree,two);
});

test('server host permission excludes port for Firefox-compatible match patterns',async()=>{
  const ui=await popup({server:'http://192.168.1.10:1024'});
  ui.element('connection').listeners.submit({preventDefault(){}});
  await settle();
  assert.equal(ui.grants[0].origins[0],'http://192.168.1.10/*');
});

test('profile controls stay hidden after connection failure and when server input changes',async()=>{
  const ui=await popup({},async({action})=>action==='status'?{ok:true,value:{}}:{ok:false,error:'offline',status:0});
  assert.equal(ui.element('profileSection').hidden,true);
  ui.element('server').value='http://localhost:1024';
  ui.element('connection').listeners.submit({preventDefault(){}});
  await settle();
  assert.equal(ui.element('profileSection').hidden,true);assert.match(ui.element('error').textContent,/offline/);
  const ok=await popup({},async({action})=>({ok:true,value:action==='status'?{}:{profiles:[]}}));
  ok.element('server').value='http://localhost:1024';ok.element('connection').listeners.submit({preventDefault(){}});await settle();
  assert.equal(ok.element('profileSection').hidden,false);
  assert.equal(ok.element('syncControls').hidden,true);
  ok.element('server').value='http://127.0.0.1:1024';ok.element('server').listeners.input();assert.equal(ok.element('profileSection').hidden,true);
});

test('selecting an existing profile prompts before binding, and cancel leaves it untouched',async()=>{
  const calls=[];
  const ui=await popup({},async message=>{calls.push(message.action);if(message.action==='status')return{ok:true,value:{}};if(message.action==='selectProfile')return{ok:true,value:{created:false,localCount:2,serverCount:3,profile:{name:'research',updated_at:5,tree:{}}}};return{ok:true,value:{profiles:[]}};},()=>false);
  ui.element('server').value='http://localhost:1024';ui.element('connection').listeners.submit({preventDefault(){}});await settle();
  ui.element('name').value='research';await ui.element('bind').onclick();
  assert.ok(calls.includes('selectProfile'));assert.equal(calls.includes('bind'),false);
});

test('renaming refreshes the shared profile name field',async()=>{
  const state={server:'http://localhost:1024',name:'research',auto:true};
  const ui=await popup(state,async({action})=>{
    if(action==='status')return{ok:true,value:structuredClone(state)};
    if(action==='list')return{ok:true,value:{profiles:[{name:state.name} ]}};
    if(action==='rename'){state.name='work';return{ok:true,value:{}};}
    if(action==='backups')return{ok:true,value:[]};
    return{ok:true,value:{}};
  });
  ui.element('name').value='work';await ui.element('rename').onclick();
  assert.equal(ui.element('name').value,'work');
});
