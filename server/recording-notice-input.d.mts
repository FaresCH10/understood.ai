import type {WorkerLocaleCode} from './languages.mjs';
export type NoticeLanguage=WorkerLocaleCode;
export type NoticeRequest={revision:number;notices:Record<NoticeLanguage,string>;scope:string};
export const noticeLanguages:readonly NoticeLanguage[];
export function noticeRequestId(value:unknown):string;
export function recordingNoticeInput(value:unknown):NoticeRequest;
export function sameNoticeRequest(left:unknown,right:NoticeRequest):boolean;
