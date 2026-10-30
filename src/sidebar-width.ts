export const DEFAULT_SIDEBAR_WIDTH=248;
export const MIN_SIDEBAR_WIDTH=200;
export const SIDEBAR_WIDTH_KEY='understood:sidebar-width';
export function sidebarWidthLimit(viewport:number){return Math.max(MIN_SIDEBAR_WIDTH,Math.min(600,Math.floor(viewport-320)));}
export function sidebarWidth(value:number,viewport:number){return Math.min(sidebarWidthLimit(viewport),Math.max(MIN_SIDEBAR_WIDTH,Math.round(Number.isFinite(value)?value:DEFAULT_SIDEBAR_WIDTH)));}
export function sidebarDragWidth(start:number,delta:number,rtl:boolean,viewport:number){return sidebarWidth(start+delta*(rtl?-1:1),viewport);}
