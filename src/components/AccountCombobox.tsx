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
  const isSelectingRef = React.useRef(false); // Prevenir múltiples selecciones

  const isEmpty = accounts.length === 0;
  
  // Buscar cuenta por código de cuenta (accountNumber) O por ID para compatibilidad
  const selectedAccount = accounts.find((account) => {
    const code = account.accountNumber || account.id;
    return code === value || account.id === value;
  });

  const getDisplayText = (account: Account) => {
    return account.accountNumber
      ? `${account.accountNumber} - ${account.name}`
      : account.name;
  };
  
  // Obtener el código de cuenta para guardar (usar accountNumber, no id interno de QB)
  const getAccountCode = (account: Account): string => {
    return account.accountNumber || account.id;
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
                  onSelect={() => {
                    // Prevenir múltiples selecciones rápidas
                    if (isSelectingRef.current) {
                      return;
                    }
                    isSelectingRef.current = true;
                    
                    // SIEMPRE enviar el ID interno de QB - el formato del código se construye en handleUpdateInvoice
                    console.log('✅ AccountCombobox: Cuenta seleccionada - ID:', account.id, 'Código:', account.accountNumber, 'Nombre:', account.name);
                    onValueChange(account.id);
                    setOpen(false);
                    setSearchQuery("");
                    
                    // Resetear después de un breve delay
                    setTimeout(() => {
                      isSelectingRef.current = false;
                    }, 500);
                  }}
                >
                <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === getAccountCode(account) || value === account.id ? "opacity-100" : "opacity-0"
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
