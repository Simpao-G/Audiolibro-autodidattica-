/** Un capitolo: lista di paragrafi, ogni paragrafo è una lista di frasi. */
export interface Chapter {
  title: string;
  paragraphs: string[][];
}

export interface Position {
  chapter: number;
  /** Indice della frase all'interno del capitolo (contando tutti i paragrafi). */
  sentence: number;
}

/** Dati leggeri mostrati in libreria. */
export interface BookMeta {
  id: string;
  title: string;
  author: string;
  /** Copertina come data URL (facoltativa). */
  cover?: string;
  format: 'epub' | 'pdf' | 'txt';
  addedAt: number;
  lastOpenedAt: number;
  position: Position;
  /** Numero di frasi per capitolo, per calcolare la percentuale. */
  chapterSizes: number[];
  /** Quando è stata salvata l'ultima posizione (ms): serve a capire quale dispositivo è più avanti. */
  positionUpdatedAt?: number;
  /** Account a cui appartiene il libro sincronizzato (assente = libro solo locale). */
  ownerId?: string;
}

export interface ParsedBook {
  title: string;
  author: string;
  cover?: string;
  format: BookMeta['format'];
  chapters: Chapter[];
}
