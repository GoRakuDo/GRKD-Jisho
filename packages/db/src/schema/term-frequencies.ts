import {
  pgTable,
  bigserial,
  integer,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { dictionaries } from "./dictionaries";

export const termFrequencies = pgTable(
  "term_frequencies",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    dictionaryId: integer("dictionary_id")
      .notNull()
      .references(() => dictionaries.id),
    expression: text("expression").notNull(),
    reading: text("reading"),
    frequencyValue: numeric("frequency_value", { precision: 20, scale: 6 }).notNull(),
    displayValue: text("display_value"),
    frequencyMode: text("frequency_mode").notNull(),
    rawJson: jsonb("raw_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_term_freq_expression").on(table.expression),
    index("idx_term_freq_dict_id").on(table.dictionaryId),
    // NULLS NOT DISTINCT: BCCWJ のような term-level (reading=NULL) entry を
    // 同一 (dictionary_id, expression) で複数持てないようにする。PG15+ 必須。
    // Drizzle 0.41 の uniqueIndex() は nullsNotDistinct() を持たないため、
    // 代わりに unique() constraint を使う (PG 上では等価)。
    unique("uq_term_freq_dict_expression_reading")
      .on(table.dictionaryId, table.expression, table.reading)
      .nullsNotDistinct(),
  ]
);

export type TermFrequency = typeof termFrequencies.$inferSelect;
export type NewTermFrequency = typeof termFrequencies.$inferInsert;
