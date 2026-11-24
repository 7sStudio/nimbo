// Arrow MAP types for the tests, typed the way apache-arrow's Map_ constructor wants its entries field.
import type { DataType } from "apache-arrow";
import { Field, Map_, Struct } from "apache-arrow";

/** MAP(key, value) as Arrow builds it: a field named entries holding a STRUCT of key and value. */
export const mapOf = <K extends DataType, V extends DataType>(key: K, value: V): Map_<K, V> =>
  new Map_(
    new Field(
      "entries",
      new Struct<{ key: K; value: V }>([new Field("key", key), new Field("value", value)]),
    ),
  );
