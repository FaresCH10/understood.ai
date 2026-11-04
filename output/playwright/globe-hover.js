async page=>{
 const session={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['preview-company','preview-site','preview-owner']),siteState:'active',mode:'synthetic-credential',clientContext:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),name:'Preview Owner',organization:'Preview Company',site:'Preview Site',timezone:'Asia/Beirut',firstRunRequired:false};
 await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname==='/api/session'?session:{items:[],total:0,unread:0})}));
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:3020/#home');await page.reload();
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 const check=async selector=>{
  const trigger=page.locator(selector).first(),globe=trigger.locator('.language-globe-map');await trigger.hover();await page.waitForTimeout(220);
  const outlineBefore=await trigger.locator('.language-globe-rim').boundingBox();
  const first=await globe.evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(220);const second=await globe.evaluate(el=>getComputedStyle(el).transform);
  if(first===second)throw Error('Continents are not moving: '+selector);
  const outlineAfter=await trigger.locator('.language-globe-rim').boundingBox();if(JSON.stringify(outlineBefore)!==JSON.stringify(outlineAfter))throw Error('Globe rim moved');
  if(await trigger.locator('.language-globe').evaluate(el=>getComputedStyle(el).transform)!=='none')throw Error('Whole icon rotated');
  await page.mouse.move(800,500);await page.waitForTimeout(500);
  const stopped=await globe.evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(200);if(stopped!==await globe.evaluate(el=>getComputedStyle(el).transform))throw Error('Map did not pause');
  await page.emulateMedia({reducedMotion:'reduce'});await trigger.hover();await page.waitForTimeout(150);
  const reduced=await globe.evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(200);
  if(reduced!==await globe.evaluate(el=>getComputedStyle(el).transform))throw Error('Reduced motion still spinning');
  await page.emulateMedia({reducedMotion:'no-preference'});return {spins:true,stopped,reducedMotion:true};
 };
 const landing=await check('.landing-site-language');
 await page.goto('http://127.0.0.1:3020/#notifications');await page.locator('.interface-language-trigger').waitFor();
 const dashboard=await check('.interface-language-trigger');await page.locator('.interface-language-trigger').click();
 if(!await page.locator('.interface-language-panel').isVisible())throw Error('Language menu failed');
 return {landing,dashboard,menuOpens:true};
}
