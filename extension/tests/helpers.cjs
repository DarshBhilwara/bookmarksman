const copy = value => structuredClone(value);
const empty = () => ({roots:{toolbar:[], menu:[], other:[], mobile:[]}});
const bookmark = title => ({type:'bookmark', title, url:`https://example.com/${encodeURIComponent(title)}`});
function fixture(firefox = false) {
  let seq = 100, state = {};
  const listeners = {};
  const calls = {created:[], removed:[], alarms:{}};
  const root = {id:firefox?'root________':'0', title:'', children:[]};
  const ids = firefox ? {toolbar:'toolbar_____',menu:'menu________',other:'unfiled_____',mobile:'mobile______'} : {toolbar:'1',other:'2'};
  for (const [kind,id] of Object.entries(ids)) root.children.push({id,parentId:root.id,title:`Localized ${kind}`,children:[],...(firefox?{type:'folder'}:{})});
  function find(id, node=root) { if(node.id===String(id)) return node; for(const child of node.children||[]) {const found=find(id,child);if(found)return found;} }
  function event(name, ...args) {for(const listener of listeners[name]||[])listener(...args);}
  const api = {
    storage:{local:{get:async key=>({[key]:copy(state[key])}),set:async patch=>{Object.assign(state,copy(patch));}}},
    bookmarks:{
      getTree:async()=>copy([root]), getChildren:async id=>copy(find(id).children||[]).map(node=>{delete node.children;return node;}),
      create:async details=>{
        if(api.failCreate)throw new Error('simulated creation failure');
        const parent=find(details.parentId);if(!parent?.children)throw new Error('invalid parent');
        const node={id:String(seq++),parentId:parent.id,title:details.title??'',...(details.url?{url:details.url}:{children:[]})};
        if(firefox)node.type=details.type||(details.url?'bookmark':'folder');
        if(details.type==='separator'){delete node.children;node.type='separator';}
        parent.children.splice(details.index??parent.children.length,0,node);calls.created.push(copy(details));event('onCreated',node.id,copy(node));return copy(node);
      },
      removeTree:async id=>remove(id),remove:async id=>{if(find(id)?.children?.length)throw new Error("Cannot remove non-empty folder");return remove(id);}
    },
    alarms:{create:async(name,details)=>{calls.alarms[name]=copy(details);},clear:async name=>{delete calls.alarms[name];return true;},get:async name=>calls.alarms[name]}
  };
  function remove(id) {if(Object.values(ids).includes(id)||id===root.id)throw new Error('permanent root deletion');const node=find(id);if(!node)throw new Error('unknown node');const parent=find(node.parentId);parent.children.splice(parent.children.findIndex(n=>n.id===id),1);calls.removed.push(id);event('onRemoved',id,{});}
  for(const name of ['onCreated','onChanged','onMoved','onRemoved','onChildrenReordered','onImportBegan','onImportEnded'])api.bookmarks[name]={addListener:fn=>(listeners[name]??=[]).push(fn)};
  return {api,root,ids,find,calls,event,state:()=>copy(state.bm||{}),setState:values=>{state.bm=copy(values);}};
}
function server(tree=empty()) {
  let profile={schema_version:1,name:'research',updated_at:1000,tree:copy(tree)};
  const calls=[];
  let offline=false, conflict=false;
  return {
    calls,get:()=>copy(profile),set:tree=>{profile={...profile,tree:copy(tree),updated_at:profile.updated_at+1};},
    offline:value=>{offline=value;},conflict:()=>{conflict=true;},
    fetch:async(url,options={})=>{
      calls.push({url,options:copy({...options,signal:undefined})});
      if(offline)throw new Error('offline');
      let status=200,body=copy(profile);
      if(url.endsWith('/health'))body={status:'ok'};
      else if(url.endsWith('/profiles'))body={profiles:[{name:profile.name,updated_at:profile.updated_at,bookmark_count:0}]};
      else if(options.method==='POST') {profile={...profile,tree:JSON.parse(options.body).tree,updated_at:1001};status=201;body=copy(profile);}
      else if(options.method==='PUT') {
        const input=JSON.parse(options.body);
        if(conflict){profile.updated_at++;conflict=false;}
        if(input.base_updated_at!==profile.updated_at){status=409;body={detail:'stale'};}
        else {profile={...profile,tree:copy(input.tree),updated_at:profile.updated_at+1};body=copy(profile);}
      }
      return {ok:status<400,status,json:async()=>copy(body)};
    }
  };
}
module.exports={copy,empty,bookmark,fixture,server};
