import {ApiError} from './auth.js';

export const postTags=[
  {id:'daily',label:'日常'},
  {id:'anime',label:'动漫'},
  {id:'games',label:'游戏'},
  {id:'music',label:'音乐'},
  {id:'share',label:'分享'}
] as const;
export function parseTag(value:unknown):string {
  if(typeof value!=='string'||!postTags.some(tag=>tag.id===value))throw new ApiError(400,'VALIDATION_ERROR','请选择有效的论坛标签');
  return value;
}
