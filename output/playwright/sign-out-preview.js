async page=>{
 let signed=true,calls=0;
 const staff={authenticated:true,role:'staff',staffRole:'owner',staffScope:JSON.stringify(['preview-company','preview-site','preview-owner']),siteState:'active',mode:'synthetic-credential',clientContext:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),name:'Preview Owner',organization:'Preview Company',site:'Preview Site',timezone:'UTC',firstRunRequired:false};
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/logout'){calls++;signed=false;}
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(path==='/api/session'?(signed?staff:{authenticated:false,mode:'synthetic-credential'}):path==='/api/logout'?{ok:true}:{items:[],total:0,unread:0})});});
 await page.reload();await page.locator('.account-disclosure summary').waitFor();
 await page.getByRole('button',{name:'Skip the tour'}).click({timeout:600}).catch(()=>{});await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:600}).catch(()=>{});
 const launch=async()=>{await page.locator('.account-disclosure summary').click();await page.locator('.account-signout').count().then(async count=>{if(count)await page.locator('.account-signout').click();else await page.locator('.account-options').getByRole('button',{name:/Sign out/}).click();});await page.getByRole('alertdialog').waitFor();};
 await launch();if(calls)throw Error('Logged out before confirming');await page.getByRole('button',{name:'Cancel',exact:true}).click();if(calls)throw Error('Cancel logged out');
 await launch();await page.keyboard.press('Escape');if(calls)throw Error('Escape logged out');
 await launch();await page.screenshot({path:'output/playwright/sign-out-confirmation.png'});await page.getByRole('alertdialog').getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL('**/#home');if(calls!==1)throw Error('Expected one logout, received '+calls);
 return {cancelKeepsSession:true,escapeKeepsSession:true,logoutRequests:calls};
}
