import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Account {
  id: string;
  name: string;
  accountNumber?: string | null;
}

interface AccountComboboxProps {
  accounts: Account[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AccountCombobox({
  accounts,
  value,
  onValueChange,
  placeholder = "Seleccionar cuenta",
  disabled = false,
  className,
}: AccountComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

  const isEmpty = accounts.length === 0;
  const selectedAccount = accounts.find((account) => account.id === value);

  const getDisplayText = (account: Account) => {
    return account.accountNumber
      ? `${account.accountNumber} - ${account.name}`
      : account.name;
  };

  const normalizeText = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  };

  const filteredAccounts = React.useMemo(() => {
    if (!searchQuery) return accounts;
    
    const normalizedQuery = normalizeText(searchQuery);
    return accounts.filter((account) => {
      const displayText = getDisplayText(account);
      const normalizedDisplay = normalizeText(displayText);
      return normalizedDisplay.includes(normalizedQuery);
    });
  }, [accounts, searchQuery]);

  return (
    <Popover open={open && !isEmpty} onOpenChange={(newOpen) => {
      if (isEmpty && newOpen) {
        console.warn('⚠️ AccountCombobox: No hay cuentas disponibles');
        return;
      }
      setOpen(newOpen);
    }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
          disabled={disabled || isEmpty}
        >
          <span className="truncate">
            {isEmpty 
              ? "Sin cuentas disponibles" 
              : selectedAccount 
                ? getDisplayText(selectedAccount) 
                : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 bg-popover z-50" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar cuenta..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>No se encontraron cuentas.</CommandEmpty>
            <CommandGroup>
              {filteredAccounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={account.id}
                  onSelect={(currentValue) => {
                    // CRÍTICO: Usar account.id directamente, no currentValue procesado
                    console.log('✅ AccountCombobox: Cuenta seleccionada -', account.id, getDisplayText(account), 'currentValue:', currentValue);
                    onValueChange(account.id);
                    setOpen(false);
                    setSearchQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === account.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="flex-1 truncate">{getDisplayText(account)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
