import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export type SidebarRowMenuKind = "context" | "dropdown";

type BaseProps = {
  kind: SidebarRowMenuKind;
  children?: ReactNode;
  className?: string;
};

type ItemProps = BaseProps & {
  disabled?: boolean;
  onSelect?: (event: Event) => void;
};

type ContentProps = BaseProps & {
  align?: "start" | "center" | "end";
  sideOffset?: number;
};

export function SidebarRowMenuPortal({
  kind,
  children,
}: {
  kind: SidebarRowMenuKind;
  children: ReactNode;
}) {
  return kind === "context" ? (
    <ContextMenu.Portal>{children}</ContextMenu.Portal>
  ) : (
    <DropdownMenu.Portal>{children}</DropdownMenu.Portal>
  );
}

export function SidebarRowMenuContent({
  kind,
  align,
  sideOffset,
  children,
  className,
}: ContentProps) {
  return kind === "context" ? (
    <ContextMenu.Content className={className}>
      {children}
    </ContextMenu.Content>
  ) : (
    <DropdownMenu.Content
      align={align}
      sideOffset={sideOffset}
      className={className}
    >
      {children}
    </DropdownMenu.Content>
  );
}

export function SidebarRowMenuItem({
  kind,
  children,
  className,
  disabled,
  onSelect,
}: ItemProps) {
  return kind === "context" ? (
    <ContextMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={className}
    >
      {children}
    </ContextMenu.Item>
  ) : (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={className}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function SidebarRowMenuSeparator({
  kind,
  className,
}: {
  kind: SidebarRowMenuKind;
  className?: string;
}) {
  return kind === "context" ? (
    <ContextMenu.Separator className={className} />
  ) : (
    <DropdownMenu.Separator className={className} />
  );
}

export function SidebarRowMenuSub({
  kind,
  children,
}: {
  kind: SidebarRowMenuKind;
  children: ReactNode;
}) {
  return kind === "context" ? (
    <ContextMenu.Sub>{children}</ContextMenu.Sub>
  ) : (
    <DropdownMenu.Sub>{children}</DropdownMenu.Sub>
  );
}

export function SidebarRowMenuSubTrigger({
  kind,
  children,
  className,
}: BaseProps) {
  return kind === "context" ? (
    <ContextMenu.SubTrigger className={className}>
      {children}
    </ContextMenu.SubTrigger>
  ) : (
    <DropdownMenu.SubTrigger className={className}>
      {children}
    </DropdownMenu.SubTrigger>
  );
}

export function SidebarRowMenuSubContent({
  kind,
  sideOffset,
  children,
  className,
}: ContentProps) {
  return kind === "context" ? (
    <ContextMenu.SubContent sideOffset={sideOffset} className={className}>
      {children}
    </ContextMenu.SubContent>
  ) : (
    <DropdownMenu.SubContent sideOffset={sideOffset} className={className}>
      {children}
    </DropdownMenu.SubContent>
  );
}
