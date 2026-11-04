async page=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/session',async route=>{await gate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false,mode:'synthetic-credential'})});});
 await page.goto('http://127.0.0.1:3020/#home',{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('.brand-loader-art').waitFor();
 const path=page.locator('.brand-ribbon > .brand-silhouette');const before=await path.getAttribute('d');await page.waitForTimeout(1800);const after=await path.getAttribute('d');
 if(before===after)throw Error('Ribbon morph is static');
 await page.waitForTimeout(1300);await page.screenshot({path:'output/playwright/ribbon-loading.png'});
 const coverage=await page.locator('.brand-loader').evaluate(el=>({position:getComputedStyle(el).position,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,screenWidth:innerWidth,screenHeight:innerHeight}));
 if(coverage.position!=='fixed'||coverage.width!==coverage.screenWidth||coverage.height!==coverage.screenHeight)throw Error('Loader does not cover viewport');
 if(await page.locator('.brand-motion-toggle').count())throw Error('Unexpected motion button');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);const still=await path.getAttribute('d');await page.waitForTimeout(350);if(still!==await path.getAttribute('d'))throw Error('Reduced motion not static');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/ribbon-loading-mobile.png'});
 release();await page.locator('.brand-loader').waitFor({state:'detached',timeout:30000});
 return {morphs:true,fullScreen:true,reducedMotion:true,disappearsWhenReady:true};
}
