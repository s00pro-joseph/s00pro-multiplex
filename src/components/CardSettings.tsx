'use client';

import { Layout, GripVertical, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AdminConfig } from '@/lib/admin.types';

interface Props {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

export default function CardSettings({ config, refreshConfig }: Props) {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Homepage toggles
  const [hp, setHp] = useState({
    showHeroBanner: true, showContinueWatching: true, showUpcomingReleases: true,
    showHotMovies: true, showHotTvShows: true, showNewAnime: true, showHotVariety: true, showHotShortDramas: true,
  });
  // Custom categories local copy for ordering
  const [cats, setCats] = useState<{ name?: string; type: 'movie' | 'tv'; query: string; disabled?: boolean; from: 'config' | 'custom' }[]>([]);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newCat, setNewCat] = useState({ name: '', type: 'movie' as 'movie'|'tv', query: '' });
  const [showAdd, setShowAdd] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}), useSensor(TouchSensor,{activationConstraint:{delay:150,tolerance:5}}));

  useEffect(()=>{
    if(config?.HomePageConfig) setHp({
      showHeroBanner: config.HomePageConfig.showHeroBanner ?? true,
      showContinueWatching: config.HomePageConfig.showContinueWatching ?? true,
      showUpcomingReleases: config.HomePageConfig.showUpcomingReleases ?? true,
      showHotMovies: config.HomePageConfig.showHotMovies ?? true,
      showHotTvShows: config.HomePageConfig.showHotTvShows ?? true,
      showNewAnime: config.HomePageConfig.showNewAnime ?? true,
      showHotVariety: config.HomePageConfig.showHotVariety ?? true,
      showHotShortDramas: config.HomePageConfig.showHotShortDramas ?? true,
    });
    if(config?.CustomCategories) { setCats([...config.CustomCategories]); setOrderChanged(false); }
  },[config]);

  const showMsg = (type:'success'|'error', text:string)=>{ setMessage({type,text}); setTimeout(()=>setMessage(null),2500); };

  const handleSaveAll = async ()=>{
    // validation: cate card must have category (query)
    for(const c of cats){
      if(!c.query?.trim()){ showMsg('error','自定义分类 query 不能为空 (cate card must have category)'); return; }
      if(!c.type){ showMsg('error','分类 type 必选'); return; }
    }
    if(showAdd && (newCat.name || newCat.query)){
      if(!newCat.query.trim()){ showMsg('error','新增分类 query 不能为空'); return; }
    }
    setSaving(true);
    try{
      const r1 = await fetch('/api/admin/homepage-config',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(hp)});
      if(!r1.ok) throw new Error((await r1.json()).error||'首页配置保存失败');
      if(orderChanged){
        const order = cats.map(c=>`${c.query}:${c.type}`);
        const r2 = await fetch('/api/admin/category',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'sort', order})});
        if(!r2.ok) throw new Error((await r2.json()).error||'排序保存失败');
      }
      await refreshConfig();
      setOrderChanged(false);
      showMsg('success','卡片设置已保存');
    }catch(e){ showMsg('error', e instanceof Error? e.message:'保存失败'); }
    finally{ setSaving(false); }
  };

  const toggleCat = async (q:string, t:'movie'|'tv')=>{
    const target = cats.find(c=>c.query===q && c.type===t);
    if(!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    const r = await fetch('/api/admin/category',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, query:q, type:t})});
    if(r.ok) await refreshConfig(); else showMsg('error','切换失败');
  };

  const deleteCat = async (q:string, t:'movie'|'tv')=>{
    const r = await fetch('/api/admin/category',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'delete', query:q, type:t})});
    if(r.ok) await refreshConfig(); else showMsg('error','删除失败');
  };

  const addCat = async ()=>{
    if(!newCat.name.trim() || !newCat.query.trim()){ showMsg('error','名称和 query 必填'); return; }
    const r = await fetch('/api/admin/category',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'add', name:newCat.name.trim(), type:newCat.type, query:newCat.query.trim()})});
    if(r.ok){ setNewCat({name:'',type:'movie',query:''}); setShowAdd(false); await refreshConfig(); showMsg('success','分类已添加'); } else showMsg('error',(await r.json()).error||'添加失败');
  };

  const handleDragEnd = (e:any)=>{
    const {active, over} = e; if(!over || active.id===over.id) return;
    const o = cats.findIndex(c=>`${c.query}:${c.type}`===active.id);
    const n = cats.findIndex(c=>`${c.query}:${c.type}`===over.id);
    setCats(prev=>arrayMove(prev,o,n)); setOrderChanged(true);
  };

  const Row = ({c}:{c: typeof cats[number]})=>{
    const {attributes,listeners,setNodeRef,transform,transition}=useSortable({id:`${c.query}:${c.type}`});
    const style={transform:CSS.Transform.toString(transform),transition} as React.CSSProperties;
    return (
      <tr ref={setNodeRef} style={style} className='hover:bg-gray-50 dark:hover:bg-gray-800'>
        <td className='px-2 py-3 cursor-grab text-gray-400' {...attributes} {...listeners}><GripVertical size={14}/></td>
        <td className='px-3 py-3 text-sm truncate max-w-[10rem]'>{c.name||'-'}</td>
        <td className='px-3 py-3'><span className={`px-2 py-1 text-xs rounded-full ${c.type==='movie'?'bg-blue-100 text-blue-700':'bg-purple-100 text-purple-700'}`}>{c.type}</span></td>
        <td className='px-3 py-3 text-sm truncate max-w-[10rem]' title={c.query}>{c.query}</td>
        <td className='px-3 py-3'><span className={`px-2 py-1 text-xs rounded-full ${!c.disabled?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{!c.disabled?'启用':'禁用'}</span></td>
        <td className='px-3 py-3 text-right space-x-1'>
          <button onClick={()=>toggleCat(c.query,c.type)} className='px-2 py-1 text-xs rounded-full bg-gray-100 hover:bg-gray-200'>{c.disabled?'启用':'禁用'}</button>
          {c.from!=='config' && <button onClick={()=>deleteCat(c.query,c.type)} className='px-2 py-1 text-xs rounded-full bg-red-50 text-red-600 hover:bg-red-100'><Trash2 size={12} className='inline'/></button>}
        </td>
      </tr>
    );
  };

  const Toggle = ({checked,onChange,label}:{checked:boolean;onChange:(v:boolean)=>void;label:string})=>(
    <label className='flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg cursor-pointer'>
      <span className='text-sm'>{label}</span>
      <button type='button' role='switch' aria-checked={checked} onClick={()=>onChange(!checked)} className={`relative inline-flex h-6 w-11 items-center rounded-full ${checked?'bg-blue-600':'bg-gray-300 dark:bg-gray-600'}`}><span className={`inline-block h-4 w-4 bg-white rounded-full transform transition ${checked?'translate-x-6':'translate-x-1'}`}/></button>
    </label>
  );

  if(!config) return <div className='py-8 text-center text-sm text-gray-500'>加载中...</div>;

  return (
    <div className='space-y-6'>
      {message && <div className={`p-3 rounded-lg text-sm ${message.type==='success'?'bg-green-50 text-green-700 border border-green-200':'bg-red-50 text-red-700 border border-red-200'}`}>{message.text}</div>}
      <div className='bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
        <h3 className='font-semibold flex items-center gap-2 mb-1'><Layout size={16} className='text-blue-500'/> 首页卡片</h3>
        <p className='text-xs text-gray-500 mb-3'>控制首页各卡片显示; 自定义分类卡片需有 query (category)，否则不保存</p>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
          <Toggle checked={hp.showHeroBanner} onChange={v=>setHp(s=>({...s,showHeroBanner:v}))} label='Hero Banner'/>
          <Toggle checked={hp.showContinueWatching} onChange={v=>setHp(s=>({...s,showContinueWatching:v}))} label='继续观看'/>
          <Toggle checked={hp.showUpcomingReleases} onChange={v=>setHp(s=>({...s,showUpcomingReleases:v}))} label='即将上映'/>
          <Toggle checked={hp.showHotMovies} onChange={v=>setHp(s=>({...s,showHotMovies:v}))} label='热门电影'/>
          <Toggle checked={hp.showHotTvShows} onChange={v=>setHp(s=>({...s,showHotTvShows:v}))} label='热门剧集'/>
          <Toggle checked={hp.showNewAnime} onChange={v=>setHp(s=>({...s,showNewAnime:v}))} label='新番放送'/>
          <Toggle checked={hp.showHotVariety} onChange={v=>setHp(s=>({...s,showHotVariety:v}))} label='热门综艺'/>
          <Toggle checked={hp.showHotShortDramas} onChange={v=>setHp(s=>({...s,showHotShortDramas:v}))} label='热门短剧'/>
        </div>
      </div>

      <div className='bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
        <div className='flex items-center justify-between mb-3'>
          <h3 className='font-semibold text-sm'>自定义分类卡片 <span className='text-xs text-gray-500'>(cate card must have category → query)</span></h3>
          <button onClick={()=>setShowAdd(v=>!v)} className={`px-3 py-1 text-sm rounded-lg ${showAdd?'bg-gray-600 text-white':'bg-green-600 text-white'}`}>{showAdd?'取消':'添加分类'}</button>
        </div>
        {showAdd && (
          <div className='p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2'>
            <input placeholder='名称 (显示名)' value={newCat.name} onChange={e=>setNewCat(s=>({...s,name:e.target.value}))} className='px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800'/>
            <select value={newCat.type} onChange={e=>setNewCat(s=>({...s,type:e.target.value as any}))} className='px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800'><option value='movie'>movie</option><option value='tv'>tv</option></select>
            <input placeholder='query (category) 必填' value={newCat.query} onChange={e=>setNewCat(s=>({...s,query:e.target.value}))} className='px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800'/>
            <button onClick={addCat} className='sm:col-span-3 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm'>确认添加</button>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={cats.map(c=>`${c.query}:${c.type}`)} strategy={verticalListSortingStrategy}>
            <div className='overflow-x-auto border rounded-lg'>
              <table className='min-w-full text-sm'>
                <thead className='bg-gray-50 dark:bg-gray-900'><tr><th className='px-2 py-2 w-6'></th><th className='px-3 py-2 text-left'>名称</th><th className='px-3 py-2'>type</th><th className='px-3 py-2'>query</th><th className='px-3 py-2'>状态</th><th className='px-3 py-2 text-right'>操作</th></tr></thead>
                <tbody className='divide-y'>{cats.map(c=> <Row key={`${c.query}:${c.type}`} c={c as any} />)}{cats.length===0 && <tr><td colSpan={6} className='py-8 text-center text-gray-400 text-sm'>暂无自定义分类</td></tr>}</tbody>
              </table>
            </div>
          </SortableContext>
        </DndContext>
        {orderChanged && <p className='text-xs text-amber-600 mt-2'>顺序已更改，请保存</p>}
      </div>

      <div className='flex justify-end gap-2'>
        <button onClick={handleSaveAll} disabled={saving} className='px-5 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50'>{saving?'保存中...':'保存卡片设置'}</button>
      </div>
    </div>
  );
}
