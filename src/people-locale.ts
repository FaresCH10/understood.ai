import {WORKER_LOCALES,type WorkerLocaleCode} from '../server/languages.mjs';
export type PeopleLocale = 'en' | 'ar';

const en = {
  locale:'Directory language',workers:'Workers',intro:'Manage workers and crews at this site.',importCsv:'Import CSV',addWorker:'Add worker',
  clearFilter:'Clear result filter',searchWorkers:'Search workers',searchPlaceholder:'Search by name or worker ID',language:'Language',allLanguages:'All languages',
  access:'Access',active:'Active',disabled:'Disabled',allStatuses:'All statuses',membership:'Membership',allCrews:'All crews',noCrew:'No crew',selectedCrew:'Selected crew',
  directory:'Worker directory',loadingWorkers:'Loading workers...',workerId:'Worker ID',accessStatus:'Access status',crew:'Crew',details:'Open details',viewMembers:'View members of',
  noWorkers:'No workers match these filters.',previousPage:'Previous page',nextPage:'Next page',editWorker:'Edit worker',closeForm:'Close form',preferred:'Preferred language',saveWorker:'Save worker',
  closeDetails:'Close worker details',edit:'Edit',disable:'Disable',cancel:'Cancel',disableWorker:'Disable worker',workerDetails:'Worker details',chooseWorker:'Select a worker to view their site membership.',
  loadingData:'Loading worker data controls...',crews:'Crews',searchCrews:'Search crews',crewStatus:'Crew status',archived:'Archived',loadingCrews:'Loading crews...',
  noCrews:'No crews match these filters.',loadingCrewPage:'Loading crew page...',previousCrews:'Previous crews',nextCrews:'Next crews',firstPage:'First page',crewName:'Crew name',crewPlaceholder:'e.g. Beirut Morning',createCrew:'Create crew',
  rename:'Rename',archive:'Archive',restore:'Restore',restoreTitle:'Restore crew?',archiveTitle:'Archive crew?',renameTitle:'Rename crew',closeCrew:'Close crew dialog',
  restoreImpact:'will accept new membership moves again. Retained memberships stay in place. Disabled workers stay disabled, and no access links or new assignments are issued.',
  archiveImpact:'will no longer accept new membership moves. Current workers keep their access and memberships. Existing assignments and responses remain unchanged.',
  renameImpact:'keeps the same crew, memberships, assignments, and responses when renamed.',
  restoreConfirm:'Restore this crew without enabling workers',archiveConfirm:'Archive this crew without disabling workers',saving:'Saving...',restoreCrew:'Restore crew',archiveCrew:'Archive crew',saveName:'Save name',
  crewRestored:'Crew restored. Worker access and past assignments are unchanged.',restoreRecorded:'The restore request was already recorded. This crew is now archived.',
  crewArchived:'Crew archived. Worker access and past assignments are unchanged.',crewRenamed:'Crew renamed. Past assignments are unchanged.',
  reenable:'Re-enable worker',reenableTitle:'Re-enable worker?',closeReenable:'Close re-enable dialog',
  reenableImpact:'will be active in this site again. Old sessions and access links stay revoked. A separate new access link is required to sign in. Past assignments, responses and crew membership are unchanged.',
  reenableConfirm:'Re-enable this worker without restoring old access links',findCrew:'Find destination crew',moveTo:'Move to crew',selected:'selected',loadingDestinations:'Loading destination crews...',
  previousDestinations:'Previous destination crews',nextDestinations:'Next destination crews',saveCrew:'Save crew',cancelCrew:'Cancel crew change',
  limited:'Worker directory access is limited to owners and supervisors.',workerAdded:'Worker added.',workerUpdated:'Worker updated.',crewCreated:'Crew created.',membershipUpdated:'Crew membership updated.',
  workerDisabled:'Worker disabled. Access revoked; past responses retained.',workerReenabled:'Worker re-enabled. Old access stays revoked; issue a new link separately.',reenableRecorded:'The re-enable request was already recorded. This worker is now disabled.',
  cleanupComplete:'Application cleanup complete. Retained history is pseudonymous; provider history, backups and device caches remain unverified.',cleanupQueued:'Deletion requested. Server access is revoked; application cleanup is queued.',
  english:'English',arabic:'Arabic',urdu:'Urdu',requestUnknown:'The operation could not be confirmed. Refresh the directory before taking another action.',
  invalidName:'Use 2–80 letters, numbers, spaces, periods, underscores, apostrophes or hyphens; start with a letter or number.',
  changed:'The crew name changed. Refresh the directory before trying again.',crewUnavailable:'The crew is unavailable or archived. Refresh the directory.',
  workerUnavailable:'The worker is unavailable. Refresh the directory.',forbidden:'Your current role or session cannot perform this action.',duplicateName:'That name is already in use in this site.',
  workerName:'Worker name',namePlaceholder:'Optional display name',chooseLater:'Worker chooses on first use',notSelected:'Not selected',
  chosenByWorker:'Chosen by worker',setByStaff:'Set by supervisor',pendingLanguage:'Language change pending',noLanguage:'No language chosen yet',
  languageRequests:'Language change requests',loadingLanguageRequests:'Loading language change requests...',noLanguageRequests:'No pending language change requests.',
  languageRequestFrom:'wants to change from',to:'to',languageRequestReason:'Reason',noReasonGiven:'No reason given.',decisionNote:'Note (optional)',
  approveLanguage:'Approve change',rejectLanguage:'Reject change',languageApproved:'Language change approved. New instructions use the new language.',languageRejected:'Language change rejected. The worker keeps the current language.',
  languageAlreadySelected:'This worker already chose a language. Update their language directly instead.',languageRequestChanged:'The request changed. Refresh the directory before deciding again.',
  languageRequestDecided:'This request was already decided. Refresh the directory.',languageRequestUnavailable:'The language request is unavailable. Refresh the directory.',
  changeAlreadyPending:'A language change is already pending for this worker.',invalidLanguage:'Choose a supported language.',
  pendingChangeTo:'Pending change to',firstUse:'Chooses on first sign-in',directCorrection:'Changing the language here overrides any pending request.',
  searchPlaceholderName:'Search by name or worker ID',workerLanguageHint:'Used for instructions and spoken audio. The worker can request a change later.',};

const ar:typeof en = {
  locale:'لغة دليل العمال',workers:'العمال',intro:'إدارة العمال والفرق في هذا الموقع.',importCsv:'استيراد CSV',addWorker:'إضافة عامل',
  clearFilter:'إلغاء تصفية النتيجة',searchWorkers:'البحث عن العمال',searchPlaceholder:'البحث بالاسم أو رقم العامل',language:'اللغة',allLanguages:'جميع اللغات',
  access:'الوصول',active:'نشط',disabled:'معطّل',allStatuses:'جميع الحالات',membership:'العضوية',allCrews:'جميع الفرق',noCrew:'دون فريق',selectedCrew:'الفريق المحدد',
  directory:'دليل العمال',loadingWorkers:'جارٍ تحميل العمال...',workerId:'رقم العامل',accessStatus:'حالة الوصول',crew:'الفريق',details:'فتح التفاصيل',viewMembers:'عرض أعضاء',
  noWorkers:'لا يوجد عمال يطابقون عوامل التصفية.',previousPage:'الصفحة السابقة',nextPage:'الصفحة التالية',editWorker:'تعديل العامل',closeForm:'إغلاق النموذج',preferred:'اللغة المفضلة',saveWorker:'حفظ العامل',
  closeDetails:'إغلاق تفاصيل العامل',edit:'تعديل',disable:'تعطيل',cancel:'إلغاء',disableWorker:'تعطيل العامل',workerDetails:'تفاصيل العامل',chooseWorker:'اختر عاملاً لعرض عضويته في الموقع.',
  loadingData:'جارٍ تحميل أدوات بيانات العامل...',crews:'الفرق',searchCrews:'البحث عن الفرق',crewStatus:'حالة الفريق',archived:'مؤرشف',loadingCrews:'جارٍ تحميل الفرق...',
  noCrews:'لا توجد فرق تطابق عوامل التصفية.',loadingCrewPage:'جارٍ تحميل صفحة الفرق...',previousCrews:'الفرق السابقة',nextCrews:'الفرق التالية',firstPage:'الصفحة الأولى',crewName:'اسم الفريق',crewPlaceholder:'مثال: فريق بيروت الصباحي',createCrew:'إنشاء فريق',
  rename:'إعادة تسمية',archive:'أرشفة',restore:'استعادة',restoreTitle:'استعادة الفريق؟',archiveTitle:'أرشفة الفريق؟',renameTitle:'إعادة تسمية الفريق',closeCrew:'إغلاق نافذة الفريق',
  restoreImpact:'سيقبل نقل العضويات إليه مجدداً. تبقى العضويات المحفوظة كما هي. يبقى العمال المعطّلون معطّلين، ولا تُصدر روابط وصول أو تكليفات جديدة.',
  archiveImpact:'لن يقبل نقل عضويات جديدة إليه. يحتفظ العمال الحاليون بوصولهم وعضوياتهم. لا تتغير التكليفات والإجابات الموجودة.',
  renameImpact:'يحتفظ بهويته وعضوياته وتكليفاته وإجاباته عند تغيير اسمه.',
  restoreConfirm:'استعادة هذا الفريق دون تفعيل العمال',archiveConfirm:'أرشفة هذا الفريق دون تعطيل العمال',saving:'جارٍ الحفظ...',restoreCrew:'استعادة الفريق',archiveCrew:'أرشفة الفريق',saveName:'حفظ الاسم',
  crewRestored:'تمت استعادة الفريق. لم يتغير وصول العمال أو التكليفات السابقة.',restoreRecorded:'سُجّل طلب الاستعادة سابقاً. الفريق مؤرشف حالياً.',
  crewArchived:'تمت أرشفة الفريق. لم يتغير وصول العمال أو التكليفات السابقة.',crewRenamed:'تم تغيير اسم الفريق. لم تتغير التكليفات السابقة.',
  reenable:'إعادة تفعيل العامل',reenableTitle:'إعادة تفعيل العامل؟',closeReenable:'إغلاق نافذة إعادة التفعيل',
  reenableImpact:'سيصبح نشطاً في هذا الموقع مجدداً. تبقى الجلسات وروابط الوصول القديمة ملغاة. يلزم رابط وصول جديد منفصل لتسجيل الدخول. لا تتغير التكليفات والإجابات والعضوية السابقة.',
  reenableConfirm:'إعادة تفعيل هذا العامل دون استعادة روابط الوصول القديمة',findCrew:'البحث عن الفريق الوجهة',moveTo:'نقل إلى فريق',selected:'محدد',loadingDestinations:'جارٍ تحميل الفرق الوجهة...',
  previousDestinations:'الفرق الوجهة السابقة',nextDestinations:'الفرق الوجهة التالية',saveCrew:'حفظ الفريق',cancelCrew:'إلغاء تغيير الفريق',
  limited:'يقتصر الوصول إلى دليل العمال على المالكين والمشرفين.',workerAdded:'تمت إضافة العامل.',workerUpdated:'تم تحديث العامل.',crewCreated:'تم إنشاء الفريق.',membershipUpdated:'تم تحديث عضوية الفريق.',
  workerDisabled:'تم تعطيل العامل وإلغاء الوصول. تبقى الإجابات السابقة محفوظة.',workerReenabled:'تمت إعادة تفعيل العامل. يبقى الوصول القديم ملغى؛ أصدر رابطاً جديداً بشكل منفصل.',reenableRecorded:'سُجّل طلب إعادة التفعيل سابقاً. العامل معطّل حالياً.',
  cleanupComplete:'اكتمل تنظيف البيانات في التطبيق. يبقى السجل بمعرّفات مستعارة؛ لم يُتحقق من سجل المزوّد والنسخ الاحتياطية وذاكرة الأجهزة.',cleanupQueued:'طُلب الحذف وأُلغي الوصول إلى الخادم. تنظيف البيانات في التطبيق قيد الانتظار.',
  english:'الإنجليزية',arabic:'العربية',urdu:'الأردية',requestUnknown:'تعذّر تأكيد العملية. حدّث الدليل قبل اتخاذ إجراء آخر.',
  invalidName:'استخدم من حرفين إلى ٨٠ حرفاً من الحروف والأرقام والمسافات والنقاط والشرطات السفلية والفواصل العليا والشرطات، وابدأ بحرف أو رقم.',
  changed:'تغيّر اسم الفريق. حدّث الدليل قبل المحاولة مجدداً.',crewUnavailable:'الفريق غير متاح أو مؤرشف. حدّث الدليل.',
  workerUnavailable:'العامل غير متاح. حدّث الدليل.',forbidden:'لا يسمح دورك أو جلستك الحالية بهذا الإجراء.',duplicateName:'هذا الاسم مستخدم بالفعل في هذا الموقع.',
  workerName:'اسم العامل',namePlaceholder:'اسم عرض اختياري',chooseLater:'يختار العامل لغته عند أول استخدام',notSelected:'غير محددة',
  chosenByWorker:'اختارها العامل',setByStaff:'حدّدها المشرف',pendingLanguage:'طلب تغيير اللغة قيد الانتظار',noLanguage:'لم تُحدَّد اللغة بعد',
  languageRequests:'طلبات تغيير اللغة',loadingLanguageRequests:'جارٍ تحميل طلبات تغيير اللغة...',noLanguageRequests:'لا توجد طلبات تغيير لغة قيد الانتظار.',
  languageRequestFrom:'يريد التغيير من',to:'إلى',languageRequestReason:'السبب',noReasonGiven:'لم يُذكر سبب.',decisionNote:'ملاحظة (اختياري)',
  approveLanguage:'الموافقة على التغيير',rejectLanguage:'رفض التغيير',languageApproved:'تمت الموافقة على تغيير اللغة. ستُستخدم اللغة الجديدة في التعليمات القادمة.',languageRejected:'تم رفض تغيير اللغة. يحتفظ العامل بلغته الحالية.',
  languageAlreadySelected:'اختار هذا العامل لغته بالفعل. حدّث لغته مباشرة بدلاً من ذلك.',languageRequestChanged:'تغيّر الطلب. حدّث الدليل قبل اتخاذ القرار.',
  languageRequestDecided:'تم البت في هذا الطلب مسبقاً. حدّث الدليل.',languageRequestUnavailable:'طلب تغيير اللغة غير متاح. حدّث الدليل.',
  changeAlreadyPending:'يوجد طلب تغيير لغة قيد الانتظار لهذا العامل بالفعل.',invalidLanguage:'اختر لغة مدعومة.',
  pendingChangeTo:'تغيير معلّق إلى',firstUse:'يختار عند أول تسجيل دخول',directCorrection:'تغيير اللغة هنا يتجاوز أي طلب معلّق.',
  searchPlaceholderName:'البحث بالاسم أو رقم العامل',workerLanguageHint:'تُستخدم للتعليمات والصوت المسموع. يمكن للعامل طلب تغييرها لاحقاً.',
};

export const peopleText = {en,ar};
export const peopleShellText = {
  en:{navigation:'Main navigation',overview:'Overview',today:'Today',briefings:'Briefings',instructions:'Instructions',clarifications:'Clarifications',people:'People',team:'Team',processing:'AI processing',reports:'Reports',settings:'Settings',more:'More',signOut:'Sign out',notifications:'Notifications',checking:'Checking session...',siteSession:'Site session',checkingSite:'Checking site session...',recheck:'Recheck session',siteError:'The current site could not be verified. Recheck your session before continuing.',archived:'This site is archived. Saved history and privacy controls remain available; new operational work is disabled.',foot:'Design concept · Synthetic data'},
  ar:{navigation:'التنقل الرئيسي',overview:'نظرة عامة',today:'اليوم',briefings:'التعليمات',instructions:'التعليمات',clarifications:'التوضيحات',people:'الأشخاص',team:'الفريق',processing:'معالجة الذكاء الاصطناعي',reports:'التقارير',settings:'الإعدادات',more:'المزيد',signOut:'تسجيل الخروج',notifications:'الإشعارات',checking:'جارٍ التحقق من الجلسة...',siteSession:'جلسة الموقع',checkingSite:'جارٍ التحقق من جلسة الموقع...',recheck:'إعادة التحقق من الجلسة',siteError:'تعذّر التحقق من الموقع الحالي. أعد التحقق من جلستك قبل المتابعة.',archived:'هذا الموقع مؤرشف. يبقى السجل وأدوات الخصوصية متاحين؛ العمل التشغيلي الجديد معطّل.',foot:'تصميم تجريبي · بيانات اصطناعية'},
  ur:{navigation:'مرکزی نیویگیشن',overview:'مجموعی جائزہ',today:'آج',briefings:'ہدایات',instructions:'ہدایات',clarifications:'وضاحتیں',people:'افراد',team:'ٹیم',processing:'مصنوعی ذہانت کی پروسیسنگ',reports:'رپورٹس',settings:'ترتیبات',more:'مزید',signOut:'سائن آؤٹ',notifications:'اطلاعات',checking:'سیشن چیک ہو رہا ہے...',siteSession:'مقام کا سیشن',checkingSite:'مقام کا سیشن چیک ہو رہا ہے...',recheck:'سیشن دوبارہ چیک کریں',siteError:'موجودہ مقام کی تصدیق نہیں ہو سکی۔ جاری رکھنے سے پہلے سیشن دوبارہ چیک کریں۔',archived:'یہ مقام محفوظ شدہ ہے۔ محفوظ تاریخ اور رازداری کے اختیارات دستیاب ہیں؛ نیا عملی کام بند ہے۔',foot:'تصوری ڈیزائن · مصنوعی ڈیٹا'},
};
export function peopleRouteLocale(view:string,preference:PeopleLocale):PeopleLocale {
  return ['people','people/crews','people/new','people/new-crew'].includes(view) || /^people\/(worker|crew)\/[^/]+$/.test(view)?preference:'en';
}
export function peopleLanguageNames(locale:PeopleLocale):Record<WorkerLocaleCode,string> {
  const t=peopleText[locale],names:Record<string,string>={en:t.english,ar:t.arabic,ur:t.urdu};
  for(const item of WORKER_LOCALES)if(!Object.hasOwn(names,item.code))names[item.code]=locale==='en'?item.englishName:item.name;
  return names as Record<WorkerLocaleCode,string>;
}
export function peoplePageText(locale:PeopleLocale,page:number,pages:number) {return locale==='ar'?`الصفحة ${page} من ${pages}`:`Page ${page} of ${pages}`;}
export function peopleShowingText(locale:PeopleLocale,count:number,total:number) {return locale==='ar'?`عرض ${count} من ${total} عامل`:`Showing ${count} of ${total} workers`;}
export function peopleDisableText(locale:PeopleLocale) {return locale==='ar'?'ستُلغى جلسات العامل وروابط وصوله. تبقى الإجابات الموجودة محفوظة في السجل.':'Their sessions and access links will be revoked. Existing answers remain in history.';}
export function peopleMessageText(locale:PeopleLocale,message:string) {
  const key=(Object.keys(en) as (keyof typeof en)[]).find(key=>en[key]===message || ar[key]===message);
  return key?peopleText[locale][key]:message;
}
export function peopleCountText(locale:PeopleLocale,count:number,kind:'workers'|'crews'|'activeCrews') {
  if(locale==='ar')return `${count} ${kind==='workers'?'عامل':kind==='activeCrews'?'فريق نشط':'فريق'}`;
  return `${count} ${kind==='workers'?(count===1?'worker':'workers'):kind==='activeCrews'?'active crews':'crews'}`;
}
export function peopleErrorText(locale:PeopleLocale,error:unknown) {
  const message=error instanceof Error?error.message:'',t=peopleText[locale];
  if(locale==='en')return message || t.requestUnknown;
  if(/Invalid (crew name|worker code)/.test(message))return t.invalidName;
  if(message==='Crew name changed')return t.changed;
  if(/Crew (unavailable|is archived)/.test(message))return t.crewUnavailable;
  if(message==='Worker unavailable')return t.workerUnavailable;
  if(message==='Language already selected')return t.languageAlreadySelected;
  if(message==='Language change already pending')return t.changeAlreadyPending;
  if(/Language request (changed|unavailable|already decided)|Worker language changed|Language selection conflict/.test(message))return message.includes('unavailable')?t.languageRequestUnavailable:message.includes('decided')?t.languageRequestDecided:t.languageRequestChanged;
  if(message==='Invalid language')return t.invalidLanguage;
  if(/Forbidden|Sign in required|Session|session/.test(message))return t.forbidden;
  if(/UNIQUE constraint|already exists|duplicate key/.test(message))return t.duplicateName;
  return t.requestUnknown;
}
