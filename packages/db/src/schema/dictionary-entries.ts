import { pgTable, bigserial, integer, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { dictionaries } from "./dictionaries";

export const dictionaryEntries = pgTable(
  "dictionary_entries",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    dictionaryId: integer("dictionary_id")
      .notNull()
      .references(() => dictionaries.id),
    term: text("term").notNull(),
    reading: text("reading").notNull(),
    definitionsJson: jsonb("definitions_json").notNull(),
    tagsJson: jsonb("tags_json").default([]),
    rawJson: jsonb("raw_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_dict_entries_term").on(table.term),
    index("idx_dict_entries_reading").on(table.reading),
    index("idx_dict_entries_dict_id").on(table.dictionaryId),
    uniqueIndex("uq_dict_entries_dict_term_reading").on(table.dictionaryId, table.term, table.reading),
  ]
);

export type DictionaryEntry = typeof dictionaryEntries.$inferSelect;
export type NewDictionaryEntry = typeof dictionaryEntries.$inferInsert;
