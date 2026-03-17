//! Utility modules for cross-platform support and common operations.

pub mod platform;

/// Build dynamic SET clauses for partial-update queries.
/// Appends `"column = ?"` to `set_clauses` and the value to `values`
/// for each `Some` field in the input struct.
macro_rules! maybe_set {
    ($input:expr, $set_clauses:expr, $values:expr, $field:ident, $col:expr) => {
        if let Some(ref val) = $input.$field {
            $set_clauses.push(format!("{} = ?", $col));
            $values.push(val.clone());
        }
    };
}

pub(crate) use maybe_set;
