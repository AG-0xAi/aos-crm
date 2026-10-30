import { type I18n } from '@lingui/core';
import { MainText } from 'src/components/MainText';
import { SubTitle } from 'src/components/SubTitle';

type WhatIsTwentyProps = {
  i18n: I18n;
};

export const WhatIsTwenty = ({ i18n }: WhatIsTwentyProps) => {
  return (
    <>
      <SubTitle value={i18n._('What is Betty?')} />
      <MainText>
        {i18n._(
          'An assistant for your business relationships: it keeps your contacts and conversations in one place and helps you prepare what comes next.',
        )}
      </MainText>
    </>
  );
};
