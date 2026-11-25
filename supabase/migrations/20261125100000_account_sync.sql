-- Account e sincronizzazione tra dispositivi.
-- Ogni utente vede e modifica SOLO i propri dati (Row Level Security).

-- Libri: metadati e punto di lettura. Il contenuto sta nello Storage (bucket "books").
create table public.books (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  author text not null default '',
  format text not null check (format in ('epub', 'pdf', 'txt')),
  cover text check (cover is null or length(cover) < 300000),
  chapter_sizes integer[] not null default '{}',
  position jsonb not null default '{"chapter": 0, "sentence": 0}',
  position_updated_at timestamptz not null default now(),
  added_at timestamptz not null default now(),
  -- Eliminazione "morbida": così anche gli altri dispositivi sanno che il libro va tolto
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index books_user_id_idx on public.books (user_id);

-- Impostazioni condivise (velocità, voce AI, tema...)
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.books enable row level security;
alter table public.user_settings enable row level security;

grant select, insert, update, delete on public.books to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
revoke all on public.books from anon;
revoke all on public.user_settings from anon;

create policy "books: lettura propri" on public.books for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "books: inserimento propri" on public.books for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "books: modifica propri" on public.books for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "books: eliminazione propri" on public.books for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "settings: lettura proprie" on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "settings: inserimento proprie" on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "settings: modifica proprie" on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Storage privato per il contenuto dei libri: <user_id>/<book_id>.json.gz
insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 52428800)
on conflict (id) do nothing;

create policy "books storage: lettura propri" on storage.objects for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "books storage: caricamento propri" on storage.objects for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "books storage: sostituzione propri" on storage.objects for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "books storage: eliminazione propri" on storage.objects for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
