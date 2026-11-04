async page=>{
 await page.evaluate(()=>localStorage.setItem('understood:interface-language','ar'));
 await page.setViewportSize({width:1440,height:1000});await page.reload();
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 await page.locator('.notifications-item').first().waitFor();
 await page.screenshot({path:'output/playwright/notifications-arabic.png',fullPage:true});
 const result=await page.evaluate(()=>({rtl:document.querySelector('.staff-shell')?.getAttribute('dir'),title:document.querySelector('.notifications-title')?.textContent,action:document.querySelector('.notifications-mark-all')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth}));
 await page.setViewportSize({width:390,height:844});await page.locator('#dashboard-sidebar button').first().click();await page.waitForTimeout(350);await page.screenshot({path:'output/playwright/notifications-arabic-mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Arabic mobile overflow');
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.notifications-tab').nth(1).click();
 await page.locator('.notifications-empty').waitFor();
 await page.evaluate(()=>localStorage.removeItem('understood:interface-language'));
 return result;
}
