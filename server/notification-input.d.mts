export const notificationKinds:Readonly<Record<string,{label:string;destination:string}>>;
export const notificationRoles:string[];
export function notificationId(value:unknown):string;
export function notificationFilters(value?:unknown):{status:string;page:number;pageSize:number};
export function notificationWindow():{asOf:string;since:string};
export function notificationRow(value:unknown):unknown;
export function notificationReadBefore(value:unknown):string;
