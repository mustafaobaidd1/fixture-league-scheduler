/** JSX types for the MathML Core elements used in the "How it works" dialog. */
import 'react';

type MathProps = import('react').HTMLAttributes<HTMLElement> & {
  display?: 'block' | 'inline';
  width?: string;
  mathvariant?: string;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      math: MathProps;
      mi: MathProps;
      mn: MathProps;
      mo: MathProps;
      mrow: MathProps;
      msub: MathProps;
      msup: MathProps;
      mspace: MathProps;
      munderover: MathProps;
      mfrac: MathProps;
    }
  }
}
