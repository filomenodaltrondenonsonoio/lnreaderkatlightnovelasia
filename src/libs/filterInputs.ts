// Type-check stub mirroring LNReader's '@libs/filterInputs'.
export enum FilterTypes {
  TextInput = 'Text',
  Picker = 'Picker',
  CheckboxGroup = 'Checkbox',
  Switch = 'Switch',
  ExcludableCheckboxGroup = 'XCheckbox',
}

export type ExcludableCheckboxGroupValue = {
  include?: string[];
  exclude?: string[];
};

export interface FilterOption {
  label: string;
  value: string;
}

export type Filter =
  | { type: FilterTypes.TextInput; label: string; value: string }
  | { type: FilterTypes.Switch; label: string; value: boolean }
  | { type: FilterTypes.Picker; label: string; value: string; options: FilterOption[] }
  | { type: FilterTypes.CheckboxGroup; label: string; value: string[]; options: FilterOption[] }
  | {
      type: FilterTypes.ExcludableCheckboxGroup;
      label: string;
      value: ExcludableCheckboxGroupValue;
      options: FilterOption[];
    };

export type Filters = Record<string, Filter>;

export type FilterToValues<T extends Filters> = {
  [K in keyof T]: { type: T[K]['type']; value: T[K]['value'] };
};
