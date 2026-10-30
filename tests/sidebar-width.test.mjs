import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarWidth,sidebarWidthLimit,sidebarDragWidth} from '../src/sidebar-width.ts';
test('sidebar drag follows the correct edge in English and RTL layouts',()=>{assert.equal(sidebarDragWidth(248,80,false,1440),328);assert.equal(sidebarDragWidth(248,-80,true,1440),328);assert.equal(sidebarDragWidth(328,80,true,1440),248);});
test('sidebar resizing keeps navigation and workspace visible and recovers invalid stored widths',()=>{assert.equal(sidebarWidth(20,1440),200);assert.equal(sidebarWidth(1200,1440),600);assert.equal(sidebarWidth(600,800),480);assert.equal(sidebarWidth(NaN,1440),248);assert.equal(sidebarWidthLimit(300),200);});
