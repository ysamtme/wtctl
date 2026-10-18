declare const RAW_XML: unique symbol;
/** Примитивное значение, которое принимает построитель XML из объекта. */
export type XmlPrimitive = string | number | boolean | null;
/** Значение узла XML: примитив, карта вложенных элементов или массив повторяющихся элементов. */
export type XmlValue = XmlPrimitive | XmlObject | XmlValue[];
/**
 * Представление объекта для `parseXml()`/`buildXml()`.
 * Ключи `@_` — атрибуты, `#text` — текст, массивы создают повторяющиеся соседние элементы.
 */
export interface XmlObject {
    [key: string]: XmlValue;
}
/** Проверенный точный фрагмент XML, который принимают поля сырых дочерних элементов и вложений. */
export interface RawXml {
    readonly [RAW_XML]: true;
    readonly xml: string;
}
/** Отклоняет литеральные символы, запрещённые XML 1.0, включая непарные суррогаты UTF-16. */
export declare function assertXmlCharacters(source: string): void;
/** Проверяет синтаксис документа и правила XML для символов и сущностей, не разбирая значения. */
export declare function validatePlatformXmlSource(source: string): void;
/**
 * Разбирает один корректный документ XML, не приводя значения к типам.
 * Префиксы пространств имён и атрибуты сохраняются; объявления DTD и сущностей отклоняются.
 */
export declare function parseXml(source: string): XmlObject;
/**
 * Сериализует `XmlObject`, экранируя значения и проверяя результат.
 * Не учитывает XMD и схему и не гарантирует побайтного совпадения при обратном разборе.
 */
export declare function buildXml(value: XmlObject): string;
/**
 * Проверяет точный фрагмент XML и помечает его для полей сырых дочерних элементов и вложений.
 * Фрагмент вставляется без экранирования; объявления DTD и сущностей по-прежнему запрещены.
 * Декларация `<?xml …?>` допустима только в самом начале; внутри SOAP клиент её убирает.
 */
export declare function rawXml(source: string): RawXml;
/** Ровно один дочерний элемент, как требует нетипизированный структурный аргумент XmElem RPC. */
export declare function rawXmlElement(source: string): RawXml;
/** Показывает, создано ли значение через `rawXml()`. */
export declare function isRawXml(value: unknown): value is RawXml;
/** Экранирует скаляр для текста и атрибутов XML; полный документ не строит. */
export declare function escapeXml(value: unknown): string;
/** Возвращает локальную часть имени XML, возможно с префиксом пространства имён. */
export declare function localName(name: string): string;
/**
 * Находит первый элемент по локальному имени обходом в глубину.
 * Не использовать этот поиск для проверки правил схемы о прямых потомках и кратности.
 */
export declare function findXmlNode(value: unknown, name: string): unknown;
export {};
