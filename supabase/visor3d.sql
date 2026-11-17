create table if not exists public.visor3d_trabajos (
  id text primary key,
  titulo text not null default 'Gemelo digital',
  usuario_id uuid,
  publicacion_id uuid,
  estado text not null default 'subiendo',
  etapa text not null default 'recibiendo',
  progreso integer not null default 0,
  mensaje text,
  motor text,
  es_video boolean not null default false,
  n_fotos integer not null default 0,
  calidad text,
  media_paths jsonb not null default '[]'::jsonb,
  modelo_path text,
  modelo_url text,
  modelo_bytes bigint,
  error text,
  proveedor text,
  proveedor_ref text,
  chequeo_en timestamptz,
  creado_en timestamptz not null default now(),
  expira_en timestamptz
);

create index if not exists visor3d_trabajos_usuario_idx
  on public.visor3d_trabajos (usuario_id, creado_en desc);

alter table public.visor3d_trabajos add column if not exists usuario_id uuid;
alter table public.visor3d_trabajos add column if not exists publicacion_id uuid;
alter table public.visor3d_trabajos add column if not exists calidad text;
alter table public.visor3d_trabajos add column if not exists modelo_bytes bigint;
alter table public.visor3d_trabajos add column if not exists proveedor text;
alter table public.visor3d_trabajos add column if not exists proveedor_ref text;
alter table public.visor3d_trabajos add column if not exists chequeo_en timestamptz;
alter table public.visor3d_trabajos add column if not exists expira_en timestamptz;

create index if not exists visor3d_trabajos_publicacion_idx
  on public.visor3d_trabajos (publicacion_id, creado_en desc);

create index if not exists visor3d_trabajos_expira_idx
  on public.visor3d_trabajos (expira_en);

alter table public.visor3d_trabajos enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'visor3d',
  'visor3d',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/avif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'model/gltf-binary',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
