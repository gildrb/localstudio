use std::ops::Range;

use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, ElementInputHandler, EntityInputHandler,
    EventEmitter, FocusHandle, Focusable, IntoElement, KeyDownEvent, MouseButton, MouseDownEvent,
    Pixels, Render, Role, ShapedLine, SharedString, TextRun, UTF16Selection, UnderlineStyle,
    Window, canvas, div, fill, point, prelude::*, px, size as dims,
};

use crate::components::{HAIRLINE, ring};
use crate::theme::{ActiveTheme, TextRole, TextRoleExt, radius, size, space};

pub enum TextFieldEvent {
    Changed(String),
}

pub struct TextField {
    focus: FocusHandle,
    text: String,
    placeholder: SharedString,
    hint: Option<SharedString>,
    selection: Range<usize>,
    marked: Option<Range<usize>>,
    last_layout: Option<ShapedLine>,
    last_bounds: Option<Bounds<Pixels>>,
}

impl EventEmitter<TextFieldEvent> for TextField {}

impl TextField {
    pub fn new(placeholder: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        TextField {
            focus: cx.focus_handle(),
            text: String::new(),
            placeholder: placeholder.into(),
            hint: None,
            selection: 0..0,
            marked: None,
            last_layout: None,
            last_bounds: None,
        }
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.text.clear();
        self.selection = 0..0;
        self.marked = None;
        cx.emit(TextFieldEvent::Changed(String::new()));
        cx.notify();
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus, cx);
    }

    pub fn hint(mut self, hint: Option<SharedString>) -> Self {
        self.hint = hint;
        self
    }

    fn replace(&mut self, range: Range<usize>, text: &str, cx: &mut Context<Self>) {
        self.text.replace_range(range.clone(), text);
        let cursor = range.start + text.len();
        self.selection = cursor..cursor;
        self.marked = None;
        cx.emit(TextFieldEvent::Changed(self.text.clone()));
        cx.notify();
    }

    fn previous(&self, at: usize) -> usize {
        self.text[..at]
            .char_indices()
            .next_back()
            .map_or(0, |(i, _)| i)
    }

    fn next(&self, at: usize) -> usize {
        self.text[at..]
            .chars()
            .next()
            .map_or(self.text.len(), |ch| at + ch.len_utf8())
    }

    fn move_to(&mut self, to: usize, extend: bool, cx: &mut Context<Self>) {
        self.selection = if extend {
            self.selection.start..to
        } else {
            to..to
        };
        if self.selection.end < self.selection.start {
            self.selection = self.selection.end..self.selection.start;
        }
        cx.notify();
    }

    fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let stroke = &event.keystroke;
        let secondary = stroke.modifiers.secondary(cx);
        let shift = stroke.modifiers.shift;
        let selection = self.selection.clone();
        let cursor = if selection.start == selection.end {
            selection.start
        } else {
            selection.end
        };
        let selected = self.text[selection.clone()].to_string();
        match (stroke.key.as_str(), secondary) {
            ("backspace", _) if selection.is_empty() => {
                let start = self.previous(cursor);
                self.replace(start..cursor, "", cx)
            }
            ("delete", _) if selection.is_empty() => {
                let end = self.next(cursor);
                self.replace(cursor..end, "", cx)
            }
            ("backspace" | "delete", _) => self.replace(selection, "", cx),
            ("left", false) => {
                let to = if shift || selection.is_empty() {
                    self.previous(cursor)
                } else {
                    selection.start
                };
                self.move_to(to, shift, cx)
            }
            ("right", false) => {
                let to = if shift || selection.is_empty() {
                    self.next(cursor)
                } else {
                    selection.end
                };
                self.move_to(to, shift, cx)
            }
            ("home", _) | ("left", true) => self.move_to(0, shift, cx),
            ("end", _) | ("right", true) => self.move_to(self.text.len(), shift, cx),
            ("a", true) => {
                self.selection = 0..self.text.len();
                cx.notify()
            }
            ("c", true) if !selected.is_empty() => {
                cx.write_to_clipboard(ClipboardItem::new_string(selected.clone()))
            }
            ("x", true) if !selected.is_empty() => {
                cx.write_to_clipboard(ClipboardItem::new_string(selected.clone()));
                self.replace(selection, "", cx)
            }
            ("v", true) => {
                let Some(pasted) = cx.read_from_clipboard().and_then(|item| item.text()) else {
                    return;
                };
                let line = pasted.replace(['\n', '\r'], " ");
                self.replace(selection, &line, cx)
            }
            _ => return,
        }
        window.prevent_default();
        cx.stop_propagation();
    }

    fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus, cx);
        let index = match (&self.last_layout, self.last_bounds) {
            (Some(layout), Some(bounds)) if !self.text.is_empty() => {
                layout.closest_index_for_x(event.position.x - bounds.left())
            }
            _ => 0,
        };
        self.move_to(index, event.modifiers.shift, cx);
    }

    fn utf16_to_byte(&self, offset: usize) -> usize {
        let mut utf16 = 0;
        for (index, ch) in self.text.char_indices() {
            if utf16 >= offset {
                return index;
            }
            utf16 += ch.len_utf16();
        }
        self.text.len()
    }

    fn byte_to_utf16(&self, offset: usize) -> usize {
        self.text[..offset.min(self.text.len())]
            .encode_utf16()
            .count()
    }

    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        let (start, end) = (
            self.utf16_to_byte(range.start),
            self.utf16_to_byte(range.end),
        );
        start.min(end)..start.max(end)
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.byte_to_utf16(range.start)..self.byte_to_utf16(range.end)
    }
}

impl Focusable for TextField {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl EntityInputHandler for TextField {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range);
        *adjusted_range = Some(self.range_to_utf16(&range));
        Some(self.text[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selection),
            reversed: false,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked.as_ref().map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.marked = None;
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked.clone())
            .unwrap_or(self.selection.clone());
        self.text.replace_range(range.clone(), text);
        let cursor = range.start + text.len();
        self.selection = cursor..cursor;
        self.marked = None;
        cx.emit(TextFieldEvent::Changed(self.text.clone()));
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        new_text: &str,
        new_selected_range: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked.clone())
            .unwrap_or(self.selection.clone());
        self.text.replace_range(range.clone(), new_text);
        self.marked = (!new_text.is_empty()).then(|| range.start..range.start + new_text.len());
        self.selection = new_selected_range
            .as_ref()
            .map(|selected| self.range_from_utf16(selected))
            .map(|selected| selected.start + range.start..selected.end + range.start)
            .unwrap_or_else(|| {
                let cursor = range.start + new_text.len();
                cursor..cursor
            });
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        element_bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let layout = self.last_layout.as_ref()?;
        let range = self.range_from_utf16(&range_utf16);
        Some(Bounds::from_corners(
            gpui::point(
                element_bounds.left() + layout.x_for_index(range.start),
                element_bounds.top(),
            ),
            gpui::point(
                element_bounds.left() + layout.x_for_index(range.end),
                element_bounds.bottom(),
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: gpui::Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let bounds = self.last_bounds?;
        let layout = self.last_layout.as_ref()?;
        let index = layout.closest_index_for_x(point.x - bounds.left());
        Some(self.byte_to_utf16(index))
    }
}

impl Render for TextField {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = cx.theme().colors;
        let entity = cx.entity();
        let focused = self.focus.is_focused(window);
        let empty = self.text.is_empty();
        let shown: SharedString = if empty {
            self.placeholder.clone()
        } else {
            self.text.clone().into()
        };
        let color = if empty { c.text_secondary } else { c.text };
        let marked = self.marked.clone();
        let selection = self.selection.clone();
        let (_, line_height, _) = TextRole::Body.metrics();
        div()
            .id("text-field")
            .key_context("TextField")
            .track_focus(&self.focus)
            .role(Role::TextInput)
            .aria_label(self.placeholder.clone())
            .aria_placeholder(self.placeholder.clone())
            .aria_value(SharedString::from(self.text.clone()))
            .when_some(self.hint.clone(), |this, hint| this.aria_keyshortcuts(hint))
            .on_key_down(cx.listener(Self::key_down))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .cursor(CursorStyle::IBeam)
            .h(px(size::CONTROL))
            .pl(px(space::S2 - HAIRLINE))
            .pr(px(space::S2 - HAIRLINE))
            .flex()
            .items_center()
            .gap(px(space::S2))
            .rounded(px(radius::CONTROL))
            .border_1()
            .border_color(c.edge)
            .bg(c.surface)
            .text_role(TextRole::Body)
            .hover(|style| style.border_color(c.edge_hover))
            .focus(|style| {
                style
                    .border_color(c.focus)
                    .shadow(ring(c.focus, HAIRLINE, true))
            })
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, _, window, cx| {
                        let style = window.text_style();
                        let run = TextRun {
                            len: shown.len(),
                            font: style.font(),
                            color,
                            background_color: None,
                            underline: None,
                            strikethrough: None,
                        };
                        let runs = match marked.filter(|_| !empty) {
                            Some(marked) => [
                                (marked.start, None),
                                (
                                    marked.end - marked.start,
                                    Some(UnderlineStyle {
                                        color: Some(color),
                                        thickness: px(HAIRLINE),
                                        wavy: false,
                                    }),
                                ),
                                (shown.len() - marked.end, None),
                            ]
                            .into_iter()
                            .filter(|(len, _)| *len > 0)
                            .map(|(len, underline)| TextRun {
                                len,
                                underline,
                                ..run.clone()
                            })
                            .collect(),
                            None => vec![run],
                        };
                        let font_size = style.font_size.to_pixels(window.rem_size());
                        let line =
                            window
                                .text_system()
                                .shape_line(shown.clone(), font_size, &runs, None);
                        let focus = entity.read(cx).focus.clone();
                        window.handle_input(
                            &focus,
                            ElementInputHandler::new(bounds, entity.clone()),
                            cx,
                        );
                        let x = |index: usize| {
                            if empty {
                                px(0.)
                            } else {
                                line.x_for_index(index)
                            }
                        };
                        if focused && selection.start != selection.end {
                            window.paint_quad(fill(
                                Bounds::from_corners(
                                    point(bounds.left() + x(selection.start), bounds.top()),
                                    point(bounds.left() + x(selection.end), bounds.bottom()),
                                ),
                                c.selected,
                            ));
                        }
                        if let Err(error) = line.paint(
                            bounds.origin,
                            px(line_height),
                            gpui::TextAlign::Left,
                            None,
                            window,
                            cx,
                        ) {
                            eprintln!("cannot draw text field: {error:#}");
                        }
                        if focused && selection.start == selection.end {
                            window.paint_quad(fill(
                                Bounds::new(
                                    point(bounds.left() + x(selection.end), bounds.top()),
                                    dims(px(size::FOCUS), bounds.size.height),
                                ),
                                c.text,
                            ));
                        }
                        entity.update(cx, |field, _| {
                            field.last_layout = Some(line);
                            field.last_bounds = Some(bounds);
                        });
                    },
                )
                .flex_1()
                .h(px(line_height)),
            )
            .children(self.hint.clone().map(|hint| {
                div()
                    .flex_none()
                    .text_role(TextRole::Caption)
                    .text_color(c.text)
                    .child(hint)
            }))
    }
}
