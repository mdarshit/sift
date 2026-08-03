/** SQL vocabulary used by the editor highlighter. */

export const KEYWORDS = new Set(
  (
    'select from where group by having order limit offset insert into values update set delete ' +
    'create table view index trigger drop alter add column rename to as distinct all union except ' +
    'intersect join inner left right full outer cross on using and or not null is in between like ' +
    'glob case when then else end exists primary key foreign references unique check default ' +
    'autoincrement with recursive over partition window rows range preceding following current row ' +
    'begin commit rollback transaction savepoint release pragma explain query plan vacuum analyze ' +
    'attach detach database if cast collate escape asc desc nulls first last returning conflict ' +
    'replace ignore abort fail temp temporary without rowid strict integer text real blob numeric ' +
    // PostgreSQL / Oracle flavor
    'serial bigserial varchar varchar2 number boolean timestamp timestamptz interval ilike lateral ' +
    'materialized sequence nextval currval grant revoke truncate merge dual rownum sysdate connect ' +
    'prior level minus procedure function returns return language sql plpgsql declare loop fetch cursor exception raise ' +
    'immutable stable volatile security definer invoker parallel safe unsafe leakproof cost rows support ' +
    'qualify for share skip locked nowait only do nothing generated always identity cascade restrict ' +
    'schema owner tablespace domain type enum comment call handler aggregate filter within cube rollup grouping'
  ).split(' '),
)

/**
 * Words which can also commonly be identifiers. Consumers that parse SQL must
 * decide from context whether these are syntax instead of relying on KEYWORDS.
 */
export const CONTEXTUAL_KEYWORDS = new Set(['type', 'owner', 'comment', 'schema', 'domain', 'support', 'rows'])

/** For the editor's highlighter when the buffer is JavaScript / JSON. */
export const JS_KEYWORDS = new Set(
  (
    'function const let var return if else for while do switch case break continue class extends ' +
    'super new this typeof instanceof in of delete void yield async await import export from default ' +
    'try catch finally throw null undefined true false static get set debugger with'
  ).split(' '),
)

export const FUNCTIONS = new Set(
  (
    'count sum avg min max total group_concat string_agg abs round floor ceil ceiling random ' +
    'length char_length substr substring instr position upper lower trim ltrim rtrim replace ' +
    'printf format hex quote typeof coalesce ifnull nullif iif nvl decode greatest least ' +
    'date time datetime julianday strftime unixepoch now age extract date_trunc date_part ' +
    'to_char to_date to_number json json_extract json_object json_array json_each json_agg ' +
    'json_build_object jsonb_agg row_number rank dense_rank percent_rank cume_dist ntile lag ' +
    'lead first_value last_value nth_value last_insert_rowid changes total_changes ' +
    'sqlite_version version concat concat_ws split_part left right lpad rpad md5 mod power sqrt exp ln log'
  ).split(' '),
)
