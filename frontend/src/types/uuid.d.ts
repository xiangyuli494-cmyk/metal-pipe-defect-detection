// uuid v9 未随包提供 .d.ts（node_modules/uuid/dist 下只有 .js），
// 本项目只用到 v4，这里给出最小可用声明，避免 tsc 报 TS7016。
// 若后续能安装 @types/uuid，可直接删除本文件。
declare module 'uuid' {
  export function v1(options?: any, buf?: any, offset?: number): string;
  export function v3(name: string | any[], namespace: string | any[], buf?: any, offset?: number): string;
  export function v4(options?: any, buf?: any, offset?: number): string;
  export function v5(name: string | any[], namespace: string | any[], buf?: any, offset?: number): string;
  export function validate(uuid: string): boolean;
  export function version(uuid: string): number;
  export function parse(uuid: string): Uint8Array;
  export function stringify(arr: any[], offset?: number): string;
  const NIL: string;
  const MAX: string;
  export { NIL, MAX };
}
