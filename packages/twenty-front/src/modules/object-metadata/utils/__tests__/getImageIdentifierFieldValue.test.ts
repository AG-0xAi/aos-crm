import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { getImageIdentifierFieldValue } from '@/object-metadata/utils/getImageIdentifierFieldValue';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { FieldMetadataType } from 'twenty-shared/types';

const buildFieldMetadataItem = (
  type: FieldMetadataType,
  name = 'imageField',
): FieldMetadataItem => ({ name, type }) as FieldMetadataItem;

const buildRecord = (value: unknown, name = 'imageField'): ObjectRecord =>
  ({ id: 'record-id', [name]: value }) as unknown as ObjectRecord;

describe('getImageIdentifierFieldValue', () => {
  it('returns null when the image identifier field metadata item is undefined', () => {
    expect(getImageIdentifierFieldValue(buildRecord('value'), undefined)).toBe(
      null,
    );
  });

  it('returns null when the field value is not defined on the record', () => {
    expect(
      getImageIdentifierFieldValue(
        buildRecord(undefined),
        buildFieldMetadataItem(FieldMetadataType.FILES),
      ),
    ).toBe(null);
  });

  describe('FILES', () => {
    it('returns the url of the first file', () => {
      expect(
        getImageIdentifierFieldValue(
          buildRecord([{ url: 'https://example.com/a.png' }]),
          buildFieldMetadataItem(FieldMetadataType.FILES),
        ),
      ).toBe('https://example.com/a.png');
    });

    it('returns null for an empty files array', () => {
      expect(
        getImageIdentifierFieldValue(
          buildRecord([]),
          buildFieldMetadataItem(FieldMetadataType.FILES),
        ),
      ).toBe(null);
    });
  });

  describe('LINKS', () => {
    // CRM-019 (R2): there is no icon provider on this deployment, so a LINKS
    // identifier resolves to null whatever the official flag says. The flag
    // case is kept to prove the absence does not depend on it.
    it('returns null even when requests to twenty-icons are allowed', () => {
      expect(
        getImageIdentifierFieldValue(
          buildRecord({ primaryLinkUrl: 'betty.management' }),
          buildFieldMetadataItem(FieldMetadataType.LINKS),
          true,
        ),
      ).toBe(null);
    });

    it('returns null when requests to twenty-icons are not allowed', () => {
      expect(
        getImageIdentifierFieldValue(
          buildRecord({ primaryLinkUrl: 'betty.management' }),
          buildFieldMetadataItem(FieldMetadataType.LINKS),
          false,
        ),
      ).toBe(null);
    });

    it('returns null when the primary link url is not defined', () => {
      expect(
        getImageIdentifierFieldValue(
          buildRecord({ primaryLinkUrl: null }),
          buildFieldMetadataItem(FieldMetadataType.LINKS),
          true,
        ),
      ).toBe(null);
    });
  });

  it('returns null for unsupported field types (image identifiers are constrained to FILES/LINKS)', () => {
    expect(
      getImageIdentifierFieldValue(
        buildRecord('https://example.com/avatar.png'),
        buildFieldMetadataItem(FieldMetadataType.TEXT),
      ),
    ).toBe(null);
  });
});
