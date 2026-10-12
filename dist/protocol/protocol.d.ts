import { type RawXml, type XmlObject } from "./xml.js";
export type SoapProfile = "native" | "web";
export type SoapScalar = string | number | boolean | RawXml | null | undefined;
export type SoapField = readonly [name: string, value: SoapScalar];
export declare function soapEnvelope(method: string, fields: readonly SoapField[], profile: SoapProfile): string;
export declare function soapContentType(profile: SoapProfile): string;
export declare function parseSoapBody(method: string, source: string, status: number): XmlObject;
export declare function xmlText(value: unknown, name: string): string | undefined;
export interface XHttpEntity {
    readonly records: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
}
export type XHttpRecord = readonly [
    name: string,
    value: string | number | boolean | undefined,
    spaceAfterColon?: boolean
];
export declare function buildXHttpEntity(action: string, records: readonly XHttpRecord[], body?: Uint8Array | string): Uint8Array;
export declare function parseXHttpEntity(bytes: Uint8Array): XHttpEntity;
