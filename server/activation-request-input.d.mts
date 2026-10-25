export type ActivationRequest={note:string|null;confirmed:true};
export function activationRequestInput(input:unknown):ActivationRequest;
export function sameActivationRequest(a:unknown,b:unknown):boolean;
