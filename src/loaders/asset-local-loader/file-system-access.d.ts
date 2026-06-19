/**
 * Minimal File System Access API surface missing from TS's lib.dom (plan 053): the permission methods and
 * `showDirectoryPicker`. lib.dom already declares `FileSystemDirectoryHandle` and its `values()` iterator.
 * Chromium-only at runtime; the `local` loader is opt-in via `VITE_ASSET_LOADER`.
 */

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
