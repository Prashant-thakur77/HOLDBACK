//! One module per instruction family. Account structs are re-exported so the
//! `#[program]` module and clients can name them directly.

pub mod attested;
pub mod close_hold;
pub mod config;
pub mod create_hold;
pub mod deposit_box;
pub mod extend_window;
pub mod flag;
pub mod instant;
pub mod reclaim;
pub mod release;
pub mod shared;
pub mod trust;

pub use attested::*;
pub use close_hold::*;
pub use config::*;
pub use create_hold::*;
pub use deposit_box::*;
pub use extend_window::*;
pub use flag::*;
pub use instant::*;
pub use reclaim::*;
pub use release::*;
pub use trust::*;
