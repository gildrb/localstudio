use std::sync::Arc;

use gpui::{FontFeatures, FontWeight, Styled, px};

pub const UI_FONT: &str = "Inter";

pub mod space {
    pub const S1: f32 = 4.;
    pub const S2: f32 = 8.;
    pub const S3: f32 = 12.;
    pub const S4: f32 = 16.;
    pub const S6: f32 = 24.;
}

pub mod size {
    pub const CONTROL: f32 = 32.;
    pub const ROW: f32 = 32.;
    pub const ROW_ACTION: f32 = 40.;
    pub const RAIL_ROW: f32 = 56.;
    pub const TITLEBAR: f32 = 40.;
    pub const RAIL: f32 = 240.;
    pub const MARK: f32 = 8.;
    pub const MARK_LARGE: f32 = 12.;
    pub const ICON: f32 = 16.;
    pub const BADGE: f32 = 20.;
    pub const FOCUS: f32 = 2.;
}

pub mod radius {
    pub const CARD: f32 = 12.;
    pub const CONTROL: f32 = 8.;

    pub const fn nested(parent: f32, inset: f32) -> f32 {
        if parent > inset { parent - inset } else { 0. }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextRole {
    Heading,
    Title,
    Label,
    Body,
    Caption,
}

impl TextRole {
    pub const fn metrics(self) -> (f32, f32, FontWeight) {
        match self {
            TextRole::Heading => (24., 32., FontWeight::SEMIBOLD),
            TextRole::Title => (16., 24., FontWeight::SEMIBOLD),
            TextRole::Label => (14., 20., FontWeight::MEDIUM),
            TextRole::Body => (14., 20., FontWeight::NORMAL),
            TextRole::Caption => (12., 16., FontWeight::SEMIBOLD),
        }
    }
}

pub trait TextRoleExt: Styled + Sized {
    fn text_role(self, role: TextRole) -> Self {
        let (text, line, weight) = role.metrics();
        self.text_size(px(text))
            .line_height(px(line))
            .font_weight(weight)
    }
}

impl<E: Styled> TextRoleExt for E {}

pub fn tabular() -> FontFeatures {
    FontFeatures(Arc::new(vec![("tnum".into(), 1)]))
}
