import {
  publicMachineCatalog,
  type MachineCatalog,
} from '../../domain/machines/machine.ts';

export type MachineService = {
  list(): ReturnType<typeof publicMachineCatalog>;
};

export function createMachineService(catalog: MachineCatalog): MachineService {
  return { list: () => publicMachineCatalog(catalog) };
}
