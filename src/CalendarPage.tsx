import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {
  Archive,Check,CheckCircle2,ChevronDown,ChevronLeft,ChevronRight,Clock3,FileText,
  MessageCircle,Mic,Pencil,RefreshCw,Send,Sparkles,TriangleAlert,Users,X,
} from 'lucide-react';
import {useArtifactRead} from './useArtifactRead';
import type {StaffRequestAuthority} from './useStaffRequest';
import {
  calendarAddDays,calendarMonthForZone,calendarMonthGrid,calendarMoveMonth,calendarTodayForZone,
  checkedCalendar,type CalendarEvent,type CalendarInstruction,type CalendarPayload,
} from './calendar-data';
import {
  calendarDayHeading,calendarDayNumber,calendarEventTitle,calendarMonthTitle,calendarOutcomeLabel,
  calendarStateLabel,calendarText,calendarTime,calendarWeekdays,type CalendarLanguage,type CalendarTextKey,
} from './calendar-locale';
import {gsap,useGSAP} from './gsap';
import './calendar.css';

type CalendarPageProps={authority:StaffRequestAuthority;refresh:number;language:CalendarLanguage;navigate:(path:string)=>void};
type CalendarDayGroup={key:string;instruction:CalendarInstruction|null;briefingId?:string;title:string;at:string;events:CalendarEvent[]};

function daysInMonth(month:string) {
  const [year,value]=month.split('-').map(Number);
  return new Date(Date.UTC(year,value,0)).getUTCDate();
}

function EventIcon({event}:{event:CalendarEvent}) {
  if(event.kind==='audio')return <Mic size={16}/>;
  if(event.kind==='clarification')return <MessageCircle size={16}/>;
  if(event.kind==='clarification_resolved'||event.kind==='response')return <CheckCircle2 size={16}/>;
  if(event.kind==='acknowledgment')return <FileText size={16}/>;
  if(event.kind==='completion')return <Check size={16}/>;
  if(event.action==='briefing.created')return <Sparkles size={16}/>;
  if(event.action==='briefing.archived'||event.action==='briefing.withdrawn')return <Archive size={16}/>;
  return <Pencil size={16}/>;
}

export function CalendarPage({authority,refresh,language,navigate}:CalendarPageProps) {
  const timezone=authority.session.timezone || 'UTC';
  const [month,setMonth]=useState(()=>calendarMonthForZone(timezone));
  const [today,setToday]=useState(()=>calendarTodayForZone(timezone));
  const [focusDate,setFocusDate]=useState(()=>calendarTodayForZone(timezone));
  const [selected,setSelected]=useState<string|null>(null);
  const [openGroups,setOpenGroups]=useState<Set<string>>(()=>new Set());
  const [tick,setTick]=useState(0);
  const root=useRef<HTMLDivElement>(null),gridRef=useRef<HTMLDivElement>(null),detailRef=useRef<HTMLDivElement>(null);
  const overlayRef=useRef<HTMLDivElement>(null),closeRef=useRef<HTMLButtonElement>(null);
  const focusPending=useRef(false),closing=useRef(false);
  const read=useArtifactRead<unknown>(authority,`/api/calendar?month=${month}`,refresh+tick);
  const parsed=useMemo(()=>{
    if(!read.data)return {data:null as CalendarPayload|null,error:read.error};
    try {return {data:checkedCalendar(read.data,month),error:read.error};}
    catch(reason) {return {data:null as CalendarPayload|null,error:(reason as Error).message};}
  },[read.data,read.error,month]);
  const [mobileMonth,setMobileMonth]=useState(false);
  const data=parsed.data,error=parsed.error,rtl=language!=='en';
  const t=(key:CalendarTextKey,values:Record<string,string|number>={})=>calendarText(language,key,values);
  const counted=(count:number,key:CalendarTextKey,one:string,many:string)=>language==='en'?`${count} ${count===1?one:many}`:t(key,{count});
  const dayPair=(instructions:number,events:number)=>language==='en'
    ?[instructions?`${instructions} ${instructions===1?'instruction':'instructions'}`:'',events?`${events} ${events===1?'update':'updates'}`:''].filter(Boolean).join(', ')
    :t('{instructions} instructions, {events} updates',{instructions,events});

  useEffect(()=>{if(data?.today)setToday(value=>value===data.today?value:data.today);},[data?.today]);
  useEffect(()=>{
    if(!focusPending.current)return;
    focusPending.current=false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
  },[focusDate,month]);

  useEffect(()=>{
    if(!selected)return;
    const frame=requestAnimationFrame(()=>closeRef.current?.focus({preventScroll:true}));
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopPropagation();
        closeDay();
        return;
      }
      if(event.key!=='Tab'||!detailRef.current)return;
      const focusable=[...detailRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter(node=>node.offsetParent!==null);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKey);
    return()=>{
      cancelAnimationFrame(frame);
      document.body.style.overflow=previousOverflow;
      document.removeEventListener('keydown',onKey);
    };
  },[selected]);

  const grid=useMemo(()=>calendarMonthGrid(month),[month]);
  const instructionsByDate=useMemo(()=>{
    const map=new Map<string,CalendarInstruction[]>();
    for(const item of data?.instructions ?? []){const list=map.get(item.date);if(list)list.push(item);else map.set(item.date,[item]);}
    return map;
  },[data]);
  const eventsByDate=useMemo(()=>{
    const map=new Map<string,CalendarEvent[]>();
    for(const event of data?.events ?? []){const list=map.get(event.date);if(list)list.push(event);else map.set(event.date,[event]);}
    return map;
  },[data]);
  const dayInstructions=selected?instructionsByDate.get(selected) ?? []:[];
  const dayEvents=selected?eventsByDate.get(selected) ?? []:[];
  const dayGroups=useMemo(()=>{
    if(!selected)return [] as CalendarDayGroup[];
    const instructions=instructionsByDate.get(selected) ?? [],events=eventsByDate.get(selected) ?? [];
    const groups:CalendarDayGroup[]=instructions.map(item=>({key:`instruction:${item.id}`,instruction:item,briefingId:item.briefingId,title:item.title,at:item.at,events:[]}));
    const byBriefing=new Map<string,CalendarDayGroup>();
    for(const group of groups)if(group.briefingId&&!byBriefing.has(group.briefingId))byBriefing.set(group.briefingId,group);
    const related=new Map<string,CalendarDayGroup>();
    for(const event of events){
      const parent=event.briefingId?byBriefing.get(event.briefingId):undefined;
      if(parent){parent.events.push(event);continue;}
      const key=`related:${event.briefingId ?? event.title}`;
      let group=related.get(key);
      if(!group){group={key,instruction:null,briefingId:event.briefingId,title:event.title,at:event.at,events:[]};related.set(key,group);}
      group.events.push(event);
    }
    const all=[...groups,...related.values()];
    for(const group of all)group.events.sort((left,right)=>left.at.localeCompare(right.at));
    return all;
  },[selected,instructionsByDate,eventsByDate]);
  const publishedCount=data?.instructions.filter(item=>item.kind==='publication').length ?? 0;
  const scheduledCount=data?.instructions.filter(item=>item.kind==='scheduled').length ?? 0;
  const updateCount=data?.events.length ?? 0;
  const daySummary=selected
    ?dayInstructions.length||dayEvents.length
      ?dayPair(dayInstructions.length,dayEvents.length)
      :t('No instructions or activity on this day.')
    :'';

  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      gsap.timeline({defaults:{ease:'power3.out'}})
        .from('.calendar-intro>*',{y:18,opacity:0,duration:.55,stagger:.08,clearProps:'opacity,transform'})
        .from('.calendar-toolbar',{y:10,opacity:0,duration:.4,clearProps:'opacity,transform'},'-=.35');
      gsap.from('.calendar-month-panel',{y:20,opacity:0,duration:.5,delay:.1,ease:'power2.out',clearProps:'opacity,transform'});
      gsap.to('.calendar-orbit',{y:-6,rotation:8,duration:5.5,ease:'sine.inOut',repeat:-1,yoyo:true});
    });
    return()=>media.revert();
  },{scope:root});

  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const cells=gsap.utils.toArray<HTMLElement>('.calendar-day:not(.is-blank)',gridRef.current);
      gsap.fromTo(cells,{opacity:0,y:14,scale:.965},{opacity:1,y:0,scale:1,duration:.4,ease:'power2.out',stagger:{each:.014},overwrite:true,clearProps:'opacity,transform'});
    });
    return()=>media.revert();
  },{dependencies:[month,data?.asOf],scope:root,revertOnUpdate:true});

  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      if(!selected||!detailRef.current)return;
      if(overlayRef.current)gsap.fromTo(overlayRef.current,{opacity:0},{opacity:1,duration:.22,ease:'power1.out',overwrite:true,clearProps:'opacity'});
      gsap.fromTo(detailRef.current,{opacity:0,y:26,scale:.972},{opacity:1,y:0,scale:1,duration:.36,ease:'power3.out',overwrite:true,clearProps:'opacity,transform'});
      gsap.fromTo(detailRef.current.querySelectorAll('.calendar-day-head,.calendar-day-badge,.calendar-day-section'),{opacity:0,y:10},{opacity:1,y:0,duration:.35,ease:'power2.out',stagger:.055,delay:.06,overwrite:true,clearProps:'opacity,transform'});
      const items=detailRef.current.querySelectorAll('.calendar-instruction-card');
      if(items.length)gsap.fromTo(items,{opacity:0,y:8},{opacity:1,y:0,duration:.3,ease:'power2.out',stagger:.025,delay:.1,overwrite:true,clearProps:'opacity,transform'});
    });
    return()=>media.revert();
  },{dependencies:[selected,data?.asOf],scope:root,revertOnUpdate:true});

  useGSAP(()=>{
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      if(!detailRef.current)return;
      for(const panel of detailRef.current.querySelectorAll<HTMLElement>('.calendar-instruction-activity')) {
        if(panel.hidden)continue;
        gsap.fromTo(panel,{opacity:0,y:-6},{opacity:1,y:0,duration:.24,ease:'power2.out',overwrite:true,clearProps:'opacity,transform'});
        const rows=panel.querySelectorAll('.calendar-event');
        if(rows.length)gsap.fromTo(rows,{opacity:0,y:6},{opacity:1,y:0,duration:.22,ease:'power2.out',stagger:.02,overwrite:true,clearProps:'opacity,transform'});
      }
    });
    return()=>media.revert();
  },{dependencies:[openGroups],scope:root,revertOnUpdate:true});

  function closeDay() {
    if(!selected||closing.current)return;
    closing.current=true;
    const date=selected;
    const finish=()=>{
      closing.current=false;
      setSelected(null);
      requestAnimationFrame(()=>{
        setFocusDate(date);
        gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
      });
    };
    const overlay=overlayRef.current,modal=detailRef.current;
    if(!overlay||!modal||window.matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
    gsap.timeline({onComplete:finish})
      .to(modal,{opacity:0,y:16,scale:.98,duration:.18,ease:'power1.in',overwrite:true})
      .to(overlay,{opacity:0,duration:.16,ease:'power1.in',overwrite:true},'-=.08');
  }
  function toggleGroup(key:string) {
    setOpenGroups(current=>{
      const next=new Set(current);
      if(next.has(key))next.delete(key);else next.add(key);
      return next;
    });
  }
  function activityList(events:CalendarEvent[]) {
    return <ol className="calendar-events">
      {events.map(event=>{
        const meta=calendarOutcomeLabel(event.outcome,language) || (event.status?calendarStateLabel(event.status,language):'');
        const worker=event.workerName?`${event.workerName}${event.worker?` (${event.worker})`:''}`:event.worker||t('Worker');
        const briefingId=event.briefingId;
        return <li className={`calendar-event is-${event.kind}`} key={event.id}>
          <span className="calendar-event-icon" aria-hidden="true"><EventIcon event={event}/></span>
          <div className="calendar-event-body">
            <strong>{calendarEventTitle(event,language)}</strong>
            <small>{event.title} · {worker}{event.reason?` · ${event.reason}`:''}</small>
            {meta&&<span className="calendar-event-meta">{meta}</span>}
            {briefingId&&<button type="button" className="text-link calendar-event-link" aria-label={`${t('Open instruction')}: ${event.title}`} onClick={()=>navigate(`briefings/${encodeURIComponent(briefingId)}`)}>{t('Open instruction')}{rtl?<ChevronLeft size={14}/>:<ChevronRight size={14}/>}</button>}
          </div>
          <time dateTime={event.at}>{calendarTime(event.at,timezone,language)}</time>
        </li>;
      })}
    </ol>;
  }
  function goToMonth(next:string,focus=false) {
    setMonth(next);
    setFocusDate(today.startsWith(`${next}-`)?today:`${next}-01`);
    focusPending.current=focus;
  }
  function shiftMonth(delta:number) {
    const next=calendarMoveMonth(month,delta);
    if(!gridRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches){goToMonth(next);return;}
    const target=gridRef.current;
    gsap.to(target,{opacity:0,y:-6,duration:.15,ease:'power1.in',overwrite:true,onComplete:()=>{
      gsap.set(target,{clearProps:'opacity,transform'});
      goToMonth(next);
    }});
  }
  function moveFocus(event:React.KeyboardEvent<HTMLButtonElement>,date:string) {
    const left=rtl?1:-1,right=rtl?-1:1;
    let next:string;
    if(event.key==='ArrowLeft')next=calendarAddDays(date,left);
    else if(event.key==='ArrowRight')next=calendarAddDays(date,right);
    else if(event.key==='ArrowUp')next=calendarAddDays(date,-7);
    else if(event.key==='ArrowDown')next=calendarAddDays(date,7);
    else if(event.key==='Home'||event.key==='End'){
      const offset=(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7;
      next=calendarAddDays(date,event.key==='Home'?-offset:6-offset);
    }else if(event.key==='PageUp'||event.key==='PageDown'){
      const nextMonth=calendarMoveMonth(month,event.key==='PageUp'?-1:1);
      next=`${nextMonth}-${String(Math.min(calendarDayNumber(date),daysInMonth(nextMonth))).padStart(2,'0')}`;
      event.preventDefault();
      setMonth(nextMonth);
      setFocusDate(next);
      focusPending.current=true;
      return;
    }else return;
    event.preventDefault();
    const nextMonth=next.slice(0,7);
    if(nextMonth!==month)setMonth(nextMonth);
    setFocusDate(next);
    focusPending.current=true;
  }

  const monthLabel=calendarMonthTitle(month,language);
  const weekdays=calendarWeekdays(language),narrowWeekdays=calendarWeekdays(language,'narrow');

  return <div className="calendar-page" ref={root}>
    <div className="page-header calendar-intro">
      <div>
        <h1>{t('Instruction calendar')}</h1>
        <p>{t('See what was sent, scheduled and answered on any day.')}</p>
        <p className="calendar-zone"><Clock3 size={14}/>{t('All times shown in {zone}.',{zone:timezone})}</p>
      </div>
    </div>
    <div className="calendar-toolbar">
      <div className="calendar-month-nav" role="group" aria-label={t('Calendar month')}>
        <button type="button" className="icon-button" aria-label={t('Previous month')} title={t('Previous month')} onClick={()=>shiftMonth(-1)}>{rtl?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button>
        <span className="calendar-month-label" aria-live="polite">{monthLabel}</span>
        <button type="button" className="icon-button" aria-label={t('Next month')} title={t('Next month')} onClick={()=>shiftMonth(1)}>{rtl?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}</button>
      </div>
      <button type="button" className="button outline calendar-today-button" onClick={()=>{setMonth(today.slice(0,7));setFocusDate(today);focusPending.current=true;}}>{t('Today')}</button>
      <button type="button" className="icon-button calendar-refresh" aria-label={t('Refresh calendar')} title={t('Refresh calendar')} disabled={read.loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={18} className={read.loading?'calendar-spin':''}/></button>
      {data&&<div className="calendar-summary">
        <span className="calendar-chip"><Send size={15}/>{publishedCount} {t('sent')}</span>
        <span className="calendar-chip is-scheduled"><Clock3 size={15}/>{scheduledCount} {t('scheduled')}</span>
        <span className="calendar-chip is-activity"><Sparkles size={15}/>{updateCount} {t('updates')}</span>
      </div>}
    </div>
    {!data
      ? error
        ? <div className="calendar-error calendar-main-error" role="alert"><TriangleAlert size={22}/><div><strong>{t('Calendar unavailable')}</strong><p>{t('The instruction calendar could not be loaded.')}</p><button type="button" className="button outline" onClick={()=>setTick(value=>value+1)} disabled={read.loading}>{t('Try again')}</button></div></div>
        : <p className="calendar-loading calendar-main-loading" role="status"><RefreshCw className="calendar-spin" size={16}/>{t('Loading calendar...')}</p>
      : <>
    {!publishedCount&&!scheduledCount&&!updateCount&&<p className="calendar-empty-month" role="status">{t('No instructions or activity were recorded this month.')}</p>}
    <div className="calendar-mobile-view"><button className="button outline" aria-pressed={!mobileMonth} onClick={()=>setMobileMonth(false)}>{rtl?'الأجندة':'Agenda'}</button><button className="button outline" aria-pressed={mobileMonth} onClick={()=>setMobileMonth(true)}>{rtl?'الشهر':'Month'}</button></div><section className="calendar-mobile-agenda" hidden={mobileMonth}>{grid.filter((date):date is string=>!!date).filter(date=>date===today||(instructionsByDate.get(date)?.length||0)>0||(eventsByDate.get(date)?.length||0)>0).map(date=><button className="calendar-agenda-day" key={date} onClick={()=>{setOpenGroups(new Set());setSelected(date);}}><strong>{calendarDayHeading(date,language)}</strong><span>{dayPair(instructionsByDate.get(date)?.length||0,eventsByDate.get(date)?.length||0)||t('Today')}</span>{(instructionsByDate.get(date)||[]).slice(0,2).map(item=><span key={item.id}>{item.title}</span>)}</button>)}{!grid.some(date=>date&&(date===today||(instructionsByDate.get(date)?.length||0)>0||(eventsByDate.get(date)?.length||0)>0))&&<p>{rtl?'لا يوجد نشاط هذا الشهر':'No activity this month.'}</p>}</section><section data-mobile-month={mobileMonth} className="calendar-month-panel" aria-label={`${t('Calendar month')} ${monthLabel}`}>
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map((day,index)=><span key={day} data-narrow={narrowWeekdays[index]}>{day}</span>)}</div>
      <div className="calendar-grid" ref={gridRef} role="group" aria-label={monthLabel}>
        {grid.map((date,index)=>{
          if(!date)return <span className="calendar-day is-blank" aria-hidden="true" key={`blank-${index}`}/>;
          const instructions=instructionsByDate.get(date) ?? [],events=eventsByDate.get(date) ?? [];
          const isToday=date===today,isSelected=date===selected;
          const label=`${calendarDayHeading(date,language)}. ${dayPair(instructions.length,events.length)}`;
          return <button type="button" key={date} data-date={date} className={`calendar-day${isToday?' is-today':''}${isSelected?' is-selected':''}`} aria-haspopup="dialog" aria-expanded={isSelected} aria-current={isToday?'date':undefined} aria-label={label} onClick={()=>{setOpenGroups(new Set());setSelected(date);}} onKeyDown={event=>moveFocus(event,date)}>
            <span className="calendar-day-top">
              <span className="calendar-day-number">{calendarDayNumber(date)}</span>
              {isToday&&<span className="calendar-day-today-label" aria-hidden="true">{t('Today')}</span>}
              {!!events.length&&<span className="calendar-day-count" aria-hidden="true">{events.length>99?'99+':events.length}</span>}
            </span>
            <span className="calendar-day-items" aria-hidden="true">
              {instructions.slice(0,2).map(item=><span className={`calendar-day-instruction is-${item.kind}`} key={item.id}><i/>{item.title}</span>)}
              {instructions.length>2&&<span className="calendar-day-more">+{instructions.length-2}</span>}
            </span>
            <span className="calendar-day-dots" aria-hidden="true">
              {events.slice(0,4).map(event=><i className={`is-${event.kind}`} key={event.id}/>)}
              {events.length>4&&<em>+{events.length-4}</em>}
            </span>
          </button>;
        })}
      </div>
      <footer className="calendar-panel-footer">
        <p className="calendar-keyboard-hint">{t('Use the arrow keys to move between days.')} {t('Select a day to see its instructions and activity.')}</p>
        <details className="calendar-legend">
          <summary>{t('Calendar legend')}<ChevronDown size={15} aria-hidden="true"/></summary>
          <div className="calendar-legend-body">
            <div className="calendar-legend-group"><strong>{t('Instructions')}</strong>
              <span><i className="is-published" aria-hidden="true"/>{t('Sent')}</span>
              <span><i className="is-scheduled" aria-hidden="true"/>{t('Scheduled')}</span>
            </div>
            <div className="calendar-legend-group"><strong>{t('Activity')}</strong>
              <span><i className="is-response" aria-hidden="true"/>{t('Response or clarification resolved')}</span>
              <span><i className="is-clarification" aria-hidden="true"/>{t('Clarification requested')}</span>
              <span><i className="is-audio" aria-hidden="true"/>{t('Voice response received')}</span>
              <span><i className="is-acknowledgment" aria-hidden="true"/>{t('Instruction acknowledged')}</span>
              <span><i className="is-completion" aria-hidden="true"/>{t('Worker marked complete')}</span>
              <span><i className="is-edit" aria-hidden="true"/>{t('Instruction edited')}</span>
            </div>
          </div>
        </details>
      </footer>
    </section>
    </>}
    {selected&&createPortal(<div className="calendar-day-overlay" ref={overlayRef} onClick={event=>{if(event.target===event.currentTarget)closeDay();}}>
      <div className="calendar-day-modal" ref={detailRef} role="dialog" aria-modal="true" aria-labelledby="calendar-day-heading" dir={rtl?'rtl':'ltr'} lang={language}>
        <div className="calendar-day-head">
          <div>
            <p className="calendar-day-kicker">{selected===today?t('Today'):t('Selected day')}</p>
            <h2 id="calendar-day-heading">{calendarDayHeading(selected,language)}</h2>
            <p>{daySummary}</p>
          </div>
          <div className="calendar-day-head-side">
            <button ref={closeRef} type="button" className="calendar-day-close" aria-label={t('Close day details')} title={t('Close day details')} onClick={closeDay}><X size={18}/></button>
            <span className="calendar-day-badge" aria-hidden="true">{calendarDayNumber(selected)}</span>
          </div>
        </div>
        <>
          <section className="calendar-day-section" aria-labelledby="calendar-instructions-heading">
            <h3 id="calendar-instructions-heading">{t('Instructions')}<span>{dayGroups.length}</span></h3>
            {!dayGroups.length?<p className="calendar-empty">{t('No instructions on this day.')}</p>:dayGroups.map((group,index)=>{
              const item=group.instruction,briefingId=group.briefingId;
              const percent=item?(item.kind==='scheduled'?0:Math.min(100,Math.max(0,item.metrics.completion))):0;
              const expandable=group.events.length>0,open=expandable&&openGroups.has(group.key);
              const panelId=`calendar-group-${index}-activity`;
              const summary=<>
                <span className="calendar-instruction-top">
                  <span className={`calendar-pill is-${item?item.kind:'related'}`}>{item?calendarStateLabel(item.state,language):t('Activity')}</span>
                  <time dateTime={group.at}>{calendarTime(group.at,timezone,language)}</time>
                </span>
                <span className="calendar-instruction-title">{group.title}</span>
                {item
                  ?<>
                    <span className="calendar-instruction-meta"><span>{t('Version {version}',{version:item.version})}</span><span><Users size={13}/>{counted(item.audience,'{count} workers','worker','workers')}</span></span>
                    <span className="calendar-progress" aria-hidden="true"><span style={{width:`${percent}%`}}/></span>
                    <span className="calendar-instruction-stats">
                      {item.kind==='scheduled'
                        ?<span><Clock3 size={14}/>{calendarStateLabel('scheduled',language)}</span>
                        :<span><CheckCircle2 size={14}/>{t('{responses} of {assigned} answered',{responses:item.metrics.responses,assigned:item.metrics.assigned})}</span>}
                      {item.metrics.clarifications>0&&<span className="is-warn"><MessageCircle size={14}/>{counted(item.metrics.clarifications,'{count} need clarification','needs clarification','need clarification')}</span>}
                      {item.openClarifications>0&&<span className="is-warn"><MessageCircle size={14}/>{counted(item.openClarifications,'{count} open clarification','open clarification','open clarifications')}</span>}
                    </span>
                  </>
                  :null}
                {expandable&&<span className="calendar-instruction-activity-hint"><Sparkles size={14}/><span>{open?t('Hide activity'):t('Show activity')}</span><span className="calendar-instruction-activity-count">{group.events.length}</span><ChevronDown size={16} className="calendar-instruction-chevron"/></span>}
              </>;
              return <article className={`calendar-instruction-card${item?` is-${item.kind}`:' is-related'}${open?' is-open':''}`} key={group.key}>
                {expandable
                  ?<button type="button" className="calendar-instruction-toggle" aria-expanded={open} aria-controls={panelId} onClick={()=>toggleGroup(group.key)}>{summary}</button>
                  :<div className="calendar-instruction-static">{summary}</div>}
                {briefingId&&<button type="button" className="text-link calendar-instruction-open" onClick={()=>navigate(`briefings/${encodeURIComponent(briefingId)}`)}>{t('Open instruction')}{rtl?<ChevronLeft size={16}/>:<ChevronRight size={16}/>}</button>}
                {expandable&&<div className="calendar-instruction-activity" id={panelId} hidden={!open}>
                  {open&&activityList(group.events)}
                </div>}
              </article>;
            })}
          </section>
        </>
      </div>
    </div>,document.body)}
  </div>;
}
