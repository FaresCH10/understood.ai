async page=>{
 await page.route('**/api/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false,mode:'synthetic-credential'})}));
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1000});await page.reload();
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 await page.locator('.hero-journey').waitFor();await page.locator('.hero-journey').scrollIntoViewIfNeeded();
 await page.evaluate(()=>window.scrollTo(0,document.querySelector('.hero-journey').getBoundingClientRect().top+scrollY-80));await page.waitForTimeout(1800);
 await page.screenshot({path:'output/playwright/journey-ornaments-desktop.png'});
 const count=await page.locator('.journey-ornament').count();if(count!==5)throw Error('Missing ornaments');
 const lineBefore=await page.locator('.journey-line-progress').evaluate(el=>el.style.strokeDashoffset);
 await page.locator('#journey-hospitality').scrollIntoViewIfNeeded();await page.waitForTimeout(1600);
 await page.screenshot({path:'output/playwright/journey-ornaments-middle.png'});
 const lineAfter=await page.locator('.journey-line-progress').evaluate(el=>el.style.strokeDashoffset);if(lineBefore===lineAfter)throw Error('Scroll line did not advance');
 await page.setViewportSize({width:390,height:844});await page.locator('.hero-journey').scrollIntoViewIfNeeded();
 await page.evaluate(()=>window.scrollTo(0,document.querySelector('.hero-journey').getBoundingClientRect().top+scrollY-60));await page.waitForTimeout(600);
 await page.screenshot({path:'output/playwright/journey-ornaments-mobile.png'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile overflow');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(200);
 const first=await page.locator('.journey-ornament').first().evaluate(el=>getComputedStyle(el).transform);await page.mouse.wheel(0,300);await page.waitForTimeout(400);
 const second=await page.locator('.journey-ornament').first().evaluate(el=>getComputedStyle(el).transform);if(first!==second)throw Error('Reduced-motion ornament moved');
 return {ornaments:count,lineBefore,lineAfter,mobileOverflow:overflow,reducedMotion:true};
}
