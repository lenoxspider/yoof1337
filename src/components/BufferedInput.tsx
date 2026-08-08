import React from 'react';
import TextInput from 'ink-text-input';

export const BufferedInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  focus?: boolean;
  placeholder?: string;
}> = ({ value, onChange, onSubmit, focus = false, placeholder }) => {
  return (
    <TextInput
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      focus={focus}
      placeholder={placeholder}
    />
  );
};
