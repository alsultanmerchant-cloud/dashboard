"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type AvatarStatus = "idle" | "loaded" | "error"

const AvatarStatusContext = React.createContext<{
  status: AvatarStatus
  setStatus: React.Dispatch<React.SetStateAction<AvatarStatus>>
} | null>(null)

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"span"> & {
  size?: "default" | "sm" | "lg"
}) {
  const [status, setStatus] = React.useState<AvatarStatus>("idle")

  return (
    <AvatarStatusContext.Provider value={{ status, setStatus }}>
      <span
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative inline-flex size-8 shrink-0 overflow-hidden rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten",
        className
      )}
      {...props}
      />
    </AvatarStatusContext.Provider>
  )
}

function AvatarImage({
  className,
  onLoad,
  onError,
  src,
  alt = "",
  ...props
}: React.ComponentProps<"img">) {
  const context = React.useContext(AvatarStatusContext)
  const imageRef = React.useRef<HTMLImageElement | null>(null)

  React.useEffect(() => {
    if (!context) return
    if (!src) {
      context.setStatus("error")
      return
    }

    const img = imageRef.current
    if (img?.complete) {
      context.setStatus(img.naturalWidth > 0 ? "loaded" : "error")
      return
    }

    context.setStatus("idle")
  }, [context, src])

  return (
    // We intentionally use a plain img here because this primitive needs
    // immediate, hydration-safe load/error state for tiny user avatars.
    // next/image adds optimization overhead without meaningful benefit.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      data-slot="avatar-image"
      className={cn(
        "absolute inset-0 aspect-square size-full rounded-full object-cover transition-opacity",
        context?.status === "loaded" ? "opacity-100" : "opacity-0",
        className
      )}
      src={src}
      alt={alt}
      onLoad={(event) => {
        context?.setStatus("loaded")
        onLoad?.(event)
      }}
      onError={(event) => {
        context?.setStatus("error")
        onError?.(event)
      }}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const context = React.useContext(AvatarStatusContext)

  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "absolute inset-0 flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs",
        context?.status === "loaded" && "opacity-0",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute end-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 rtl:flex-row-reverse rtl:space-x-reverse *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
