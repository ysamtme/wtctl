import { type RawXml, type XmlObject } from "./xml.js";
export type SoapProfile = "native" | "web";
export type SoapScalar = string | number | boolean | RawXml | null | undefined;
export type SoapField = readonly [name: string, value: SoapScalar];
export declare function soapEnvelope(method: string, fields: readonly SoapField[], profile: SoapProfile): string;
export declare function soapContentType(profile: SoapProfile): string;
export declare function parseSoapBody(method: string, source: string, status: number): XmlObject;
export declare function xmlText(value: unknown, name: string): string | undefined;
