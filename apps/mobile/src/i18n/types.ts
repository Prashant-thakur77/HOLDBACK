import type { en } from './en';

/** Turns the literal types of the English copy into plain strings with the same shape. */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

/** The shape every language file must have. */
export type Dictionary = Widen<typeof en>;

export interface Plural {
  one: string;
  other: string;
}

type IsPlural<T> = T extends { one: string; other: string } ? true : false;

/** Dotted paths to every string (a plural pair counts as one key). */
type Paths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : IsPlural<T[K]> extends true
          ? K
          : `${K}.${Paths<T[K]>}`;
    }[keyof T & string];

export type MessageKey = Paths<typeof en>;

export type MessageVars = Record<string, string | number>;
